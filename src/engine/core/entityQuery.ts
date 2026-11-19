import {type Component, type ComponentCtor} from "./component";
import {EntityArchetype, NO_SOURCE_COLUMN, type OccupancyWatcher} from "./entityArchetype";
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

function typeNames(tokens: readonly AnyCT[]): string {
    return tokens.map(token => token.ctor.name).join(", ");
}

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

    private _tracked: boolean = false;
    private _occupiedArchetypes: number = 0;
    private _occupancyWatchers: readonly OccupancyWatcher[] = [];
    private readonly _archetypeWatcher: OccupancyWatcher = {
        onOccupancyChanged: occupied => this.countArchetypeOccupancyChange(occupied),
    };

    constructor(private _source: WorldSource, include: IncSpec, exclude?: ExcSpec) {
        this._include = toTokens(include) as TokensOfList<IncSpec>;
        this._exclude = toTokens(exclude ?? []) as TokensOfList<ExcSpec>;
        _source.adoptQuery(this as unknown as EntityQuery);
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

    public track(): void {
        if (this._tracked) return;
        const archetypes = this.getCachedArchetypes();
        let occupied = 0;
        for (let i = 0; i < archetypes.length; i++) {
            const arch = archetypes[i];
            arch.addOccupancyWatcher(this._archetypeWatcher);
            if (arch.enabledEntityCount > 0) occupied++;
        }
        this._occupiedArchetypes = occupied;
        this._tracked = true;
    }

    public addOccupancyWatcher(watcher: OccupancyWatcher): void {
        this.track();
        this._occupancyWatchers = [...this._occupancyWatchers, watcher];
    }

    public removeOccupancyWatcher(watcher: OccupancyWatcher): void {
        this._occupancyWatchers = this._occupancyWatchers.filter(existing => existing !== watcher);
    }

    private countArchetypeOccupancyChange(occupied: boolean): void {
        const wasOccupied = this._occupiedArchetypes > 0;
        if (occupied) this._occupiedArchetypes++;
        else this._occupiedArchetypes--;
        const isOccupied = this._occupiedArchetypes > 0;
        if (wasOccupied !== isOccupied) this.notifyOccupancyWatchers(isOccupied);
    }

    private notifyOccupancyWatchers(occupied: boolean): void {
        const watchers = this._occupancyWatchers;
        for (let i = 0; i < watchers.length; i++) watchers[i].onOccupancyChanged(occupied);
    }

    public dispose(): void {
        const world = this._lazyLoaded.world;
        if (world !== undefined) {
            world.archetypes.onCreateArchetype.remove(this.onArchetypeCreated);
            world.archetypes.onPruneArchetype.remove(this.onArchetypePruned);
        }
        if (this._tracked) {
            const cached = this._lazyLoaded.cachedArchetypes;
            for (let i = 0; i < cached.length; i++) cached[i].removeOccupancyWatcher(this._archetypeWatcher);
            this._tracked = false;
            this._occupiedArchetypes = 0;
        }
        this._occupancyWatchers = [];
        this._lazyLoaded.world = undefined!;
        this._lazyLoaded.cachedArchetypes = [];
        this.getWorld = this.getCachedArchetypes = this.throwDisposed;
    }

    private throwDisposed(): never {
        throw new Error(`EntityQuery used after dispose(): include [${typeNames(this._include)}], exclude [${typeNames(this._exclude)}]`);
    }

    private onArchetypeCreated = (arch: EntityArchetype<AnyCT>) => {
        if (!this.matches(arch)) return;
        this._lazyLoaded.cachedArchetypes.push(arch);
        if (this._tracked) arch.addOccupancyWatcher(this._archetypeWatcher);
    };

    private onArchetypePruned = (arch: EntityArchetype<AnyCT>) => {
        const cached = this._lazyLoaded.cachedArchetypes;
        const index = cached.indexOf(arch);
        if (index === -1) return;
        cached.splice(index, 1);
        if (this._tracked) arch.removeOccupancyWatcher(this._archetypeWatcher);
    };

    private matches(arch: EntityArchetype<AnyCT>): boolean {
        const include = this._include, exclude = this._exclude;
        for (let i = 0; i < include.length; i++) if (arch.columnIndexOf(include[i]) === NO_SOURCE_COLUMN) return false;
        for (let i = 0; i < exclude.length; i++) if (arch.columnIndexOf(exclude[i]) !== NO_SOURCE_COLUMN) return false;
        return true;
    }

    private refreshCache(): void {
        const next: EntityArchetype<AnyCT>[] = [];
        for (const arch of this.getWorld().archetypes.values()) {
            if (this.matches(arch)) next.push(arch);
        }
        this._lazyLoaded.cachedArchetypes = next;
    }

    private findSingletonRowOrAmbiguous(
        specOrConstructors: Record<string, TokenOrCtor>,
        options?: EntityStreamOptions<boolean>,
    ): any {
        const spec = toTokenSpec(specOrConstructors);
        const keys = Object.keys(spec);
        let rowData: any = undefined;
        for (const arch of this.archetypes) {
            const entityCount = options?.includeDisabled ? arch.entityCountIncludingDisabled : arch.enabledEntityCount;
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
        const row = this.findSingletonRowOrAmbiguous(specOrConstructors, options);
        if (row === AMBIGUOUS || row === undefined) return undefined;
        return row;
    }

    public getSingleton<
        S extends Record<string, TokenOrCtor>,
        IncludeEntity extends boolean = false
    >(specOrConstructors: S,
      options?: EntityStreamOptions<IncludeEntity>): RowFromSpec<TokensFrom<S>, IncU<Inc>> &
        (IncludeEntity extends true ? { entity: Entity } : {}) {
        const row = this.findSingletonRowOrAmbiguous(specOrConstructors, options);
        if (row === AMBIGUOUS) throw new Error("More than 1 singleton entity found");
        if (row === undefined) throw new Error("No entity found");
        return row;
    }

    public hasEntity(): boolean {
        if (this._tracked) return this._occupiedArchetypes > 0;
        for (const arch of this.archetypes) {
            if (arch.enabledEntityCount > 0) return true;
        }
        return false;
    }

    public enabledEntityCount(): number {
        let count = 0;
        for (const arch of this.archetypes) {
            const n = arch.enabledEntityCount;
            count += n;
        }
        return count;
    }

    public entityCountIncludingDisabled(): number {
        let count = 0;
        for (const arch of this.archetypes) {
            const n = arch.entityCountIncludingDisabled;
            count += n;
        }
        return count;
    }

    public* [Symbol.iterator](): IterableIterator<Entity> {
        for (const arch of this.archetypes) {
            const n = arch.enabledEntityCount;
            for (let i = 0; i < n; i++) yield arch.getEntityAtIndex(i);
        }
    }

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

