import {type Component, type ComponentCtor} from "./component";
import {EntityArchetype} from "./entityArchetype";
import {World} from "./world";
import {Entity} from "./entity";
import {EntityStreamOptions} from "./entityStreamOptions";
import {
    AnyCT,
    CompMap,
    IncU,
    RowFromSpec,
    TokensFrom,
    TokensOfList,
    toTokens,
    toTokenSpec,
    TupleToUnion
} from "../util/tokenUtils";
import {EntityQueryStream} from "./entityQueryStream";
import {WorldSource} from "./worldSource";

type TokenOrCtor = AnyCT | ComponentCtor<Component>;

function hasAll<CT extends AnyCT>(arch: EntityArchetype<CT>, required: readonly CT[]): boolean {
    const have = new Set(arch.componentTypes as readonly CT[]);
    for (const t of required) if (!have.has(t)) return false;
    return true;
}

function hasNone<CT extends AnyCT>(arch: EntityArchetype<CT>, excluded: readonly CT[]): boolean {
    const have = new Set(arch.componentTypes as readonly CT[]);
    for (const t of excluded) if (have.has(t)) return false;
    return true;
}

/** Sentinel for "more than one entity matched", which the two callers treat differently. */
const AMBIGUOUS = Symbol("ambiguous singleton");

export class EntityQuery<
    IncSpec extends readonly TokenOrCtor[] = readonly[],
    ExcSpec extends readonly TokenOrCtor[] = readonly[],
    Inc extends readonly AnyCT[] = TokensOfList<IncSpec>,
    Exc extends readonly AnyCT[] = TokensOfList<ExcSpec>,
> {
    private readonly _include: readonly TupleToUnion<Inc>[];
    private readonly _exclude: readonly TupleToUnion<Exc>[];

    private _lazyLoaded: {
        world: World;
        cachedArchetypes: EntityArchetype<AnyCT>[]
    } = {
        world: undefined!,
        cachedArchetypes: []
    }

    constructor(private _source: WorldSource, include: IncSpec, exclude?: ExcSpec) {
        this._include = toTokens(include) as TokensOfList<IncSpec>;
        this._exclude = toTokens(exclude ?? []) as TokensOfList<ExcSpec>;
    }

    private bindToWorld() {
        if (!this._source.world) throw new Error("World not set")
        this._lazyLoaded.world = this._source.world;
        this.getWorld = () => this._lazyLoaded.world;
        this.getCachedArchetypes = () => this._lazyLoaded.cachedArchetypes;
        this.refreshCache();
        this._lazyLoaded.world.archetypes.onCreateArchetype.add(this.onArchetypeCreated);
        this._lazyLoaded.world.archetypes.onPruneArchetype.add(this.onArchetypePruned);
    }

    private getWorld() {
        this.bindToWorld()
        return this._lazyLoaded.world
    }

    private getCachedArchetypes(): EntityArchetype<AnyCT>[] {
        this.bindToWorld()
        return this._lazyLoaded.cachedArchetypes
    }

    public get archetypes(): IterableIterator<EntityArchetype<AnyCT>> {
        return this.getCachedArchetypes().values();
    }

    private onArchetypeCreated = (arch: EntityArchetype<AnyCT>) => {
        if (this.matches(arch)) this.getCachedArchetypes().push(arch);
    };

    private onArchetypePruned = (arch: EntityArchetype<AnyCT>) => {
        const arr = this.getCachedArchetypes();
        const index = arr.indexOf(arch);
        if (index !== -1) arr.splice(index, 1);
    };

    private matches(arch: EntityArchetype<AnyCT>): boolean {
        return hasAll(arch, this._include as readonly AnyCT[]) &&
            hasNone(arch, this._exclude as readonly AnyCT[]);
    }

    private refreshCache(): void {
        const next: EntityArchetype<AnyCT>[] = [];
        for (const arch of this.getWorld().archetypes.values()) {
            if (this.matches(arch)) next.push(arch);
        }
        this._lazyLoaded.cachedArchetypes = next;
    }

    /**
     * Shared body of getSingleton/tryGetSingleton, which differ only in whether "none" and
     * "more than one" return or throw. Cold path -- once per frame per camera at most.
     * Returns AMBIGUOUS if more than one entity matched, undefined if none did.
     */
    private findSingletonRow(
        specOrConstructors: Record<string, TokenOrCtor>,
        options?: EntityStreamOptions<boolean>,
    ): any {
        const spec = toTokenSpec(specOrConstructors);
        const keys = Object.keys(spec);
        let rowData: any = undefined;
        for (const arch of this.archetypes) {
            const entityCount = options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
            if (entityCount == 0) continue;
            if (entityCount > 1) return AMBIGUOUS;
            if (rowData != undefined) return AMBIGUOUS;

            const data = arch.getDataAtIndexUntracked(0) as Map<AnyCT, Component>;
            rowData = {};
            if (options?.includeEntity) rowData.entity = arch.getEntityAtIndex(0);
            for (const k of keys) rowData[k] = data.get(spec[k] as AnyCT);
        }
        return rowData;
    }

    public tryGetSingleton<
        S extends Record<string, TokenOrCtor>,
        IncludeEntity extends boolean = false
    >(specOrConstructors: S,
      options?: EntityStreamOptions<IncludeEntity>): (RowFromSpec<TokensFrom<S>, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {})) | undefined {
        const row = this.findSingletonRow(specOrConstructors, options);
        if (row === AMBIGUOUS || row === undefined) return undefined;
        return row;
    }

    public getSingleton<
        S extends Record<string, TokenOrCtor>,
        IncludeEntity extends boolean = false
    >(specOrConstructors: S,
      options?: EntityStreamOptions<IncludeEntity>): RowFromSpec<TokensFrom<S>, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {}) {
        const row = this.findSingletonRow(specOrConstructors, options);
        if (row === AMBIGUOUS) throw new Error("More than 1 singleton entity found");
        if (row === undefined) throw new Error("No entity found");
        return row;
    }

    public hasEntity(): boolean {
        for (const arch of this.archetypes) {
            if (arch.entityCount > 0) return true;
        }
        return false;
    }

    public entityCount(): number {
        let count = 0;
        for (const arch of this.archetypes) {
            const n = arch.entityCount;
            count += n;
        }
        return count;
    }

    public entityCountUnfiltered(): number {
        let count = 0;
        for (const arch of this.archetypes) {
            const n = arch.entityCountUnfiltered;
            count += n;
        }
        return count;
    }

    /** for loop over entities */
    public* [Symbol.iterator](): IterableIterator<Entity> {
        for (const arch of this.archetypes) {
            const n = arch.entityCount;
            for (let i = 0; i < n; i++) yield arch.getEntityAtIndex(i);
        }
    }

    /**
     * Iterate matching entities, declaring which components are read and which
     * are written:
     *
     *     query.stream({
     *         read:  {pos: LocalPosition},
     *         write: {bounds: WorldSpaceRenderBounds},
     *     }).consume(({pos, bounds}) => { ... });
     *
     * Reads come back deeply readonly; writes come back mutable and have their
     * columns stamped once per archetype. See EntityQueryStream for why this
     * replaced the per-component Proxy.
     */
    public stream<
        R extends CompMap = {},
        W extends CompMap = {},
        O extends CompMap = {},
        IncludeEntity extends boolean = false
    >(
        spec: { read?: R; write?: W; optional?: O },
        options?: EntityStreamOptions<IncludeEntity>
    ): EntityQueryStream<R, W, O, IncludeEntity> {
        return new EntityQueryStream<R, W, O, IncludeEntity>(this.archetypes, spec, options);
    }
}

