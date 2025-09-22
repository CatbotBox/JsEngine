import {type Component, type ComponentCtor} from "./component";
import {EntityArchetype} from "./entityArchetype";
import {World} from "./world";
import {Entity} from "./entity";
import {EntityStreamOptions} from "./entityStream";
import {
    AnyCT,
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
        const arr = this.getCachedArchetypes(); // array of refs

        function* iter(): IterableIterator<EntityArchetype<AnyCT>> {
            // In-place compaction: single pass, no per-item splicing
            let w = 0; // write index for the next kept ref
            for (let r = 0; r < arr.length; r++) {
                const ref = arr[r].deref();
                if (ref !== undefined) {
                    if (w !== r) arr[w] = arr[r]; // move loaded ref forward only when needed
                    w++;
                    yield ref;
                }
                // unloaded refs are skipped
            }
            if (w !== arr.length) arr.length = w; // drop all skipped refs in one truncate
        }

        return iter();
    }

    private onArchetypeCreated = (arch: EntityArchetype<AnyCT>) => {
        if (this.matches(arch)) this.getCachedArchetypes().push(new WeakRef(arch));
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

    public getSingletonEntity(options?: { includeDisabled?: boolean }): Entity {
        let entity: Entity | undefined;
        for (const arch of this.archetypes) {
            const entityCount = options?.includeDisabled ? arch.entityCountUnfiltered : arch.entityCount;
            if (entityCount == 0) continue;
            if (entityCount > 1) throw new Error("More than 1 singleton entity found");
            if (entityCount == 1) {
                if (entity != undefined) throw new Error("More than 1 singleton entity found");
                entity = arch.getEntityAtIndex(0);
            }
        }
        if (entity) return entity;
        throw new Error("No entity found");
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

    /** Iterate all matching entity handles. */
    public forEachEntity(cb: (entity: Entity) => void): void {
        for (const arch of this.archetypes) {
            const n = arch.entityCount;
            for (let i = 0; i < n; i++) cb(arch.getEntityAtIndex(i));
        }
    }

    /** for loop over entities */
    public* [Symbol.iterator](): IterableIterator<Entity> {
        for (const arch of this.archetypes) {
            const n = arch.entityCount;
            for (let i = 0; i < n; i++) yield arch.getEntityAtIndex(i);
        }
    }


    public stream<
        S extends Record<string, TokenOrCtor>,
        IncludeEntity extends boolean = false
    >(
        specOrConstructors: S,
        options?: EntityStreamOptions<IncludeEntity>
    ): EntityQueryStream<TokensFrom<S>, IncludeEntity, Inc> {
        const spec = toTokenSpec(specOrConstructors);
        return new EntityQueryStream<TokensFrom<S>, IncludeEntity, Inc>(
            this.archetypes,
            spec,
            options
        );
    }
}

