// src/core/System.ts

import type {World} from "./world";
import {EntityStreamRow} from "./entityStream";
import type {Component} from "./component";
import type {ComponentCtor} from "./component";
import {ComponentType as CT} from "./component";
import {EntityQuery} from "./entityQuery";
import {
    AnyCT,
    CtorSpec,
    TokenOrCtor,
    TokensFrom,
    TokensOfList,
    TokenSpec,
    toTokens,
    ToTokens
} from "../util/tokenUtils";
import {EntityManager} from "./entityManager";
import {SystemGroup} from "./systemGroup";

// type AnyCT = CT<any>;
// type TokenSpec = Record<string, AnyCT>;
// type CtorSpec = Record<string, ComponentCtor<Component>>;
//
// // helper: build a token spec from constructors
// function specFromCtors<C extends CtorSpec>(ctors: C) {
//   const out: any = {};
//   for (const k of Object.keys(ctors) as (keyof C)[]) {
//     out[k] = CT.of(ctors[k] as any);
//   }
//   return out as { [K in keyof C]: AnyCT };
// }


// nice alias so you never have to spell ToTokens<...> at call sites
type QueryOf<
    Inc extends readonly TokenOrCtor[],
    Exc extends readonly TokenOrCtor[] = []
> = EntityQuery<ToTokens<Inc>, ToTokens<Exc>>;

// capture tuples without `as const`
export const tuple = <T extends readonly unknown[]>(...xs: T) => xs;


type RowFrom<S> = EntityStreamRow<TokensFrom<S>>;

// runtime converter (ctors -> tokens), tokens pass through
function toTokenSpec<S extends TokenSpec | CtorSpec>(specOrCtors: S): TokensFrom<S> {
    const entries = Object.entries(specOrCtors);
    const firstVal = entries[0]?.[1];

    // if first value is a function, assume ctor-spec; otherwise token-spec
    if (typeof firstVal === "function") {
        const out: any = {};
        for (const [k, ctor] of entries as [string, ComponentCtor<Component>][]) {
            out[k] = CT.of(ctor);
        }
        return out as TokensFrom<S>;
    }
    return specOrCtors as unknown as TokensFrom<S>;
}

/**
 * Unity-like base System with OnCreate/OnUpdate and a fluent Entities API.
 */
export abstract class System {
    public world!: World;
    private _enabled = true;
    private _requiredAnyForUpdate: EntityQuery[] | undefined;
    private _requiredAllForUpdate: EntityQuery[] | undefined;
    private _lastUpdateTime: number = 0;

    protected get lastUpdateTime(): number {
        return this._lastUpdateTime;
    }

    public constructor() {
    }

    public priority(): number {
        return 0;
    }

    protected systemGroup(): new () => SystemGroup {
        const {RootSystemGroup} = require("./rootSystemGroup");
        return RootSystemGroup;
    }

    protected get entityManager(): EntityManager {
        return this.world.entityManager;
    }

    protected requireAnyForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = readonly[],
    >(include: IncSpec, exclude?: ExcSpec): void
    protected requireAnyForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(query: EntityQuery<IncSpec, ExcSpec>): void
    protected requireAnyForUpdate<IncSpec extends readonly TokenOrCtor[], ExcSpec extends readonly TokenOrCtor[] = []>(input: IncSpec | EntityQuery<TokensOfList<IncSpec>, TokensOfList<ExcSpec>>, input2?: ExcSpec): void {
        let query = input as unknown as EntityQuery
        if (Array.isArray(input)) {
            const inc = toTokens(input) as TokensOfList<IncSpec>;
            const exc = toTokens(input2 ?? []) as TokensOfList<ExcSpec>;
            query = new EntityQuery(this, inc, exc) as unknown as EntityQuery;
        }
        if (!this._requiredAnyForUpdate) {
            this._requiredAnyForUpdate = [query]
            return;
        }
        this._requiredAnyForUpdate.push(query);
    }

    protected requireAllForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(include: IncSpec, exclude?: ExcSpec): void
    protected requireAllForUpdate<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(query: EntityQuery<IncSpec, ExcSpec>): void
    protected requireAllForUpdate<IncSpec extends readonly TokenOrCtor[], ExcSpec extends readonly TokenOrCtor[] = []>(input: IncSpec | EntityQuery<TokensOfList<IncSpec>, TokensOfList<ExcSpec>>, input2?: ExcSpec): void {
        let query = input as unknown as EntityQuery
        if (Array.isArray(input)) {
            const inc = toTokens(input) as TokensOfList<IncSpec>;
            const exc = toTokens(input2 ?? []) as TokensOfList<ExcSpec>;
            query = new EntityQuery(this, inc, exc) as unknown as EntityQuery;
        }
        if (!this._requiredAllForUpdate) {
            this._requiredAllForUpdate = [query]
            return;
        }
        this._requiredAllForUpdate.push(query);
    }


    public create(): void {
        const updateGroup = this.world.getOrCreateSystem(this.systemGroup())
        updateGroup.addSystemInstance(this)
        this.onCreate();
        if (this.enabled) this.onEnable();
    }

    protected onCreate(): void {
    }

    public destroy(): void {
        if (this.enabled) this.onDisable();
        this.onDestroy();
    }

    protected onDestroy(): void {
        // override to clean up resources
    }

    /** Your per-frame logic goes here */
    public abstract onUpdate(): void;

    /** Called by World each frame */
    public update(): void {
        if (!this._enabled) return;
        if (this._requiredAnyForUpdate) {
            const update = this._requiredAnyForUpdate.findIndex(query => query.hasEntity())
            if (update === -1) return;
        }
        if (this._requiredAllForUpdate) {
            const update = this._requiredAllForUpdate.every(query => query.hasEntity())
            if (!update) return;
        }
        this.onUpdate();
        this._lastUpdateTime = this.world.time.elapsedTime;
    }

    public get enabled(): boolean {
        return this._enabled;
    }

    public set enabled(v: boolean) {
        if (v === this.enabled) return; // no change
        if (v) {
            this._enabled = true;
            this.onEnable();
        } else {
            this.onDisable();
            this._enabled = false;
        }
    }

    protected onEnable(): void {

    }

    protected onDisable(): void {

    }

    // ----------------------------
    // Simple, immediate iteration
    // ----------------------------

    //scrapped in favor of caching

// inside class System
    /** Build an EntityQuery from an array of tokens *or* constructors (no labels). */
    protected createEntityQuery<
        IncSpec extends readonly TokenOrCtor[],
        ExcSpec extends readonly TokenOrCtor[] = []
    >(
        include: IncSpec,
        exclude?: ExcSpec
    ): EntityQuery<IncSpec, ExcSpec> {
        return new EntityQuery(this, include, exclude);
    }
}