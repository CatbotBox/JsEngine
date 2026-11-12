import {EntityQuery} from "./entityQuery";
import {
    TokenOrCtor,
    TokensOfList,
    toTokens,
} from "../util/tokenUtils";
import {EntityManager} from "./entityManager";
import type {SystemGroup} from "./systemGroup";
import {WorldSource} from "./worldSource";

export type SystemCtor<T extends System> = new () => T;

const CREATE_GROUP_IF_MISSING = true;
const EXISTING_GROUP_ONLY = false;

export abstract class System extends WorldSource {
    private _enabled = true;
    private _requiredAnyForUpdate: EntityQuery[] | undefined;
    private _requiredAllForUpdate: EntityQuery[] | undefined;
    private _lastUpdateTime: number = 0;
    private _isCreated: boolean = false;

    protected get lastUpdateTime(): number {
        return this._lastUpdateTime;
    }

    protected updateLastUpdateTime() {
        this._lastUpdateTime = this.world.time.elapsedTime;
    }

    public constructor() {
        super(undefined!)
    }

    public priority(): number {
        return 0;
    }

    protected systemGroup(): (new () => SystemGroup) | undefined {
        return undefined;
    }

    private resolveUpdateGroup(createIfMissing: boolean): SystemGroup | undefined {
        const group = this.systemGroup();
        if (group === undefined) return this.world.rootSystemGroup;
        return createIfMissing ? this.world.getOrCreateSystem(group) : this.world.tryGetSystem(group);
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
        if (this._isCreated) return;
        const updateGroup = this.resolveUpdateGroup(CREATE_GROUP_IF_MISSING);
        const isRootGroupCreatingItself = updateGroup === undefined || (updateGroup as System) === this;
        if (!isRootGroupCreatingItself) updateGroup.addSystemInstance(this);
        this._isCreated = true;
        this.onCreate();
        if (this.enabled) this.onEnable();
    }

    protected onCreate(): void {
    }

    public destroy(): void {
        if (!this._isCreated) return;
        if (this.enabled) this.onDisable();
        this._isCreated = false;
        this.onDestroy();
        const updateGroup = this.resolveUpdateGroup(EXISTING_GROUP_ONLY);
        if (!updateGroup) return;
        updateGroup.removeSystemInstance(this);
        this.world.removeSystem(this.constructor as SystemCtor<this>);
    }

    protected onDestroy(): void {
    }

    public abstract onUpdate(): void;

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
        if (v === this.enabled) return;
        if (v) {
            this._enabled = true;
            this.onEnable();
        } else {
            this.onDisable();
            this._enabled = false;
        }
    }

    public onEnable(): void {

    }

    public onDisable(): void {

    }

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