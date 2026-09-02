import {type Component, type ComponentCtor} from "./component";
import {EntityArchetype} from "./entityArchetype";
import {World} from "./world";
import {Entity} from "./entity";
import {EntityStreamOptions} from "./entityStream";
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
        cachedArchetypes: WeakRef<EntityArchetype<AnyCT>>[]
    } = {
        world: undefined!,
        cachedArchetypes: []
    }

    constructor(private _source: WorldSource, include: IncSpec, exclude?: ExcSpec) {
        this._include = toTokens(include) as TokensOfList<IncSpec>;
        this._exclude = toTokens(exclude ?? []) as TokensOfList<ExcSpec>;
    }

    private ensureWorldAdded() {
        if (!this._source.world) throw new Error("World not set")
        this._lazyLoaded.world = this._source.world;
        this.getWorld = () => this._lazyLoaded.world;
        this.getCachedArchetypes = () => this._lazyLoaded.cachedArchetypes;
        this.refreshCache();
        this._lazyLoaded.world.archetypes.onCreateArchetype.add(this.onArchetypeCreated);
    }

    private getWorld() {
        this.ensureWorldAdded()
        return this._lazyLoaded.world
    }

    private getCachedArchetypes(): WeakRef<EntityArchetype<AnyCT>>[] {
        this.ensureWorldAdded()
        return this._lazyLoaded.cachedArchetypes
    }

    public get archetypes(): IterableIterator<EntityArchetype<AnyCT>> {
        const arr = this.getCachedArchetypes();

        //don't dedupe in iter as multiple systems could be using it
        function* iter(): IterableIterator<EntityArchetype<AnyCT>> {
            for (let readIndex = 0; readIndex < arr.length; readIndex++) {
                const ref = arr[readIndex].deref();
                if (ref === undefined) continue;
                yield ref;
            }
        }

        return iter();
    }

    private onArchetypeCreated = (arch: EntityArchetype<AnyCT>) => {
        if (this.matches(arch)) {

            const arr = this.getCachedArchetypes();

            // In-place compaction: single pass, no per-item splicing
            let writeIndex = 0;
            for (let readIndex = 0; readIndex < arr.length; readIndex++) {
                const ref = arr[readIndex].deref();
                if (ref === undefined) continue;
                if (writeIndex !== readIndex) arr[writeIndex] = arr[readIndex];
                writeIndex++;
            }
            if (writeIndex + 1 !== arr.length) arr.length = writeIndex;
            arr[writeIndex] = new WeakRef(arch);
        }
    };

    private matches(arch: EntityArchetype<AnyCT>): boolean {
        return hasAll(arch, this._include as readonly AnyCT[]) &&
            hasNone(arch, this._exclude as readonly AnyCT[]);
    }

    private refreshCache(): void {
        const next: WeakRef<EntityArchetype<AnyCT>>[] = [];
        for (const arch of this.getWorld().archetypes.values()) {
            const a = arch as EntityArchetype<AnyCT>;
            if (this.matches(a)) next.push(new WeakRef(a));
        }
        this._lazyLoaded.cachedArchetypes = next;
    }

    public tryGetSingleton<
        S extends Record<string, TokenOrCtor>,
        IncludeEntity extends boolean = false
    >(specOrConstructors: S,
      options?: EntityStreamOptions<IncludeEntity>): (RowFromSpec<TokensFrom<S>, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {})) | undefined {
        const spec = toTokenSpec(specOrConstructors);
        const keys = Object.keys(spec) as (keyof S)[];
        let rowData: any = undefined;
        for (const arch of this.archetypes) {
            const entityCount = options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
            if (entityCount == 0) continue;
            if (entityCount > 1) return undefined;
            if (entityCount == 1) {
                if (rowData != undefined) return undefined;
                const data = arch.getDataAtIndexUntracked(0) as Map<AnyCT, Component>;
                rowData = {};
                if (options?.includeEntity) rowData.entity = arch.getEntityAtIndex(0);

                for (const k of keys) {
                    const token = spec[k] as AnyCT;
                    rowData[k as string] = data.get(token);
                }
            }
        }
        if (rowData) return rowData;
        return undefined;
    }

    public getSingleton<
        S extends Record<string, TokenOrCtor>,
        IncludeEntity extends boolean = false
    >(specOrConstructors: S,
      options?: EntityStreamOptions<IncludeEntity>): RowFromSpec<TokensFrom<S>, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {}) {
        const spec = toTokenSpec(specOrConstructors);
        const keys = Object.keys(spec) as (keyof S)[];
        let rowData: any = undefined;
        for (const arch of this.archetypes) {
            const entityCount = options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
            if (entityCount == 0) continue;
            if (entityCount > 1) throw new Error("More than 1 singleton entity found");
            if (entityCount == 1) {
                if (rowData != undefined) throw new Error("More than 1 singleton entity found");
                const data = arch.getDataAtIndexUntracked(0) as Map<AnyCT, Component>;
                rowData = {};
                if (options?.includeEntity) rowData.entity = arch.getEntityAtIndex(0);

                for (const k of keys) {
                    const token = spec[k] as AnyCT;
                    rowData[k as string] = data.get(token);
                }
            }
        }
        if (rowData) return rowData;
        throw new Error("No entity found");
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

