import {ComponentType, ComponentOf, Component, ComponentCtor} from "./component";
import type {F32Backed} from "./componentType";
import {trackComponent} from "./trackedComponent";
import {Entity} from "./entity";
import {AnyCT} from "../util/tokenUtils";
import {getEntityName, getEntityRow, getOwner, setEntityRow} from "./ownership";
import {WorldSource} from "./worldSource";

export class ComponentLookup<T extends Component, CT extends ComponentType<T> = ComponentType<T>, MISC extends AnyCT[] = []> {
    private readonly _token: ComponentType<T>
    private _options?: { filterLastUpdated: number | undefined }

    constructor(private _worldSource: WorldSource, componentType: ComponentCtor<T>) {
        this._token = ComponentType.of(componentType);
    }

    public update(options?: { filterLastUpdated: number | undefined }) {
        this._options = options;
    }

    public tryGetComponent(entity: Entity, readonly?: false): ComponentOf<CT> | undefined
    public tryGetComponent(entity: Entity, readonly: true): Readonly<ComponentOf<CT>> | undefined
    public tryGetComponent(entity: Entity, readonly: boolean = false): ComponentOf<CT> | undefined {
        const archetype = getOwner(this._worldSource.world, entity);
        if (!archetype) return undefined;
        const componentStore = archetype.getColumn(this._token);
        if (!componentStore) return undefined;
        if (this._options && this._options.filterLastUpdated !== undefined &&
            (archetype.lastStructuralChangeTime > this._options.filterLastUpdated || componentStore.lastUpdatedTime > this._options.filterLastUpdated)) {
            return undefined;
        }
        const id = archetype.getIndexOfEntity(entity);
        if (id === undefined) return undefined; // stale handle: recycled or destroyed
        const component = componentStore.get(id);
        if (readonly) return component;
        return trackComponent(component, () => componentStore.lastUpdatedTime = performance.now());
    }
}

/**
 * Entities per change-tracking block.
 *
 * 128 costs one f64 per 128 entities (~1.3 KB for a 21k-entity column) and makes a
 * tail append dirty 0.6% of that column instead of 100% of it. Profiling at 129,008
 * entities in 6 archetypes showed a still scene costing 41 ms/frame and the same
 * scene under churn costing ~196 ms -- the entire difference being systems
 * reprocessing tens of thousands of unchanged entities because a few hundred
 * neighbours in the same archetype had changed.
 */
export const BLOCK_SHIFT = 7;
export const BLOCK_SIZE = 1 << BLOCK_SHIFT;

export class ComponentStore<CT extends ComponentType<any>> {
    private readonly _componentData: ComponentOf<CT>[] = [];

    /**
     * SoA backing for components whose class declares `static f32Width = N`
     * (see {@link F32Backed} in componentType.ts): entity i's floats live at
     * [i*width, (i+1)*width). The instances in _componentData stay — they carry
     * identity, methods, and long-lived handles — but their typed-array fields
     * are views into this column, rebound whenever their row moves. Systems on
     * hot paths read this column directly instead of touching instances.
     */
    private _f32: Float32Array | undefined;
    private readonly _f32Width: number;

    constructor(token?: CT) {
        this._f32Width = token?.f32Width ?? 0;
        if (this._f32Width > 0) this._f32 = new Float32Array(8 * this._f32Width);
    }

    /** The raw SoA column, or undefined when this type is object-backed. */
    public get f32Data(): Float32Array | undefined {
        return this._f32;
    }

    public get f32Width(): number {
        return this._f32Width;
    }

    private ensureF32Capacity(count: number) {
        const width = this._f32Width;
        const cur = this._f32!;
        if (count * width <= cur.length) return;
        let cap = cur.length || 8 * width;
        while (cap < count * width) cap *= 2;
        const grown = new Float32Array(cap);
        grown.set(cur);
        this._f32 = grown;
        // Growth moved the buffer, so every live instance's views are stale.
        const data = this._componentData;
        for (let i = 0; i < data.length; i++) {
            (data[i] as unknown as F32Backed).bindF32(grown, i * width);
        }
    }
    // Column-wide maximum of _blockTimes. Kept for the cheap whole-column reject in
    // EntityQueryStream.plans() and for ComponentLookup, which has no block context.
    private _lastUpdatedTime: number = 0;

    /** _blockTimes[b] = when anything in entities [b*BLOCK_SIZE, +BLOCK_SIZE) last changed. */
    private _blockTimes = new Float64Array(8);

    public get lastUpdatedTime(): number {
        return this._lastUpdatedTime;
    }

    /**
     * Whole-column stamp. Every block becomes at least this recent, so callers that
     * cannot say *which* entity changed (ComponentLookup, tracked-component proxies)
     * stay correct at the cost of waking the whole column.
     */
    public set lastUpdatedTime(value: number) {
        if (this._lastUpdatedTime > value) return;
        this._lastUpdatedTime = value;
        this._blockTimes.fill(value, 0, this.blockCount);
    }

    /** Number of blocks currently backing this column's entities. */
    public get blockCount(): number {
        return (this._componentData.length + BLOCK_SIZE - 1) >> BLOCK_SHIFT;
    }

    private ensureBlocks(count: number) {
        if (count <= this._blockTimes.length) return;
        let cap = this._blockTimes.length || 8;
        while (cap < count) cap *= 2;
        const grown = new Float64Array(cap);
        grown.set(this._blockTimes);
        this._blockTimes = grown;
    }

    /** Mark the block holding `index` as changed at `time`. */
    public markBlockAt(index: number, time: number) {
        const b = index >> BLOCK_SHIFT;
        this.ensureBlocks(b + 1);
        if (this._blockTimes[b] < time) this._blockTimes[b] = time;
        if (this._lastUpdatedTime < time) this._lastUpdatedTime = time;
    }

    /** Did anything in block `b` change at or after `since`? */
    public blockChangedSince(b: number, since: number): boolean {
        return this._blockTimes[b] >= since;
    }

    public swapValues(indexA: number, indexB: number) {
        const data = this._componentData;
        const temp = data[indexA];
        data[indexA] = data[indexB];
        data[indexB] = temp;
        const width = this._f32Width;
        if (width > 0) {
            // values travel with their instances: swap the float spans, then
            // re-point both instances at their new rows
            const f = this._f32!;
            const a = indexA * width, b = indexB * width;
            for (let k = 0; k < width; k++) {
                const t = f[a + k];
                f[a + k] = f[b + k];
                f[b + k] = t;
            }
            (data[indexA] as unknown as F32Backed).bindF32(f, a);
            (data[indexB] as unknown as F32Backed).bindF32(f, b);
        }
    }

    public add(component: ComponentOf<CT>, time: { elapsedTime: number }) {
        const index = this._componentData.length;
        if (this._f32Width > 0) {
            // grow BEFORE pushing: ensureF32Capacity rebinds every instance in
            // _componentData, and the incoming one must not be rebound (to the
            // zero-filled slot) before writeF32 has copied its values in
            this.ensureF32Capacity(index + 1);
        }
        this._componentData.push(component);
        if (this._f32Width > 0) {
            const off = index * this._f32Width;
            const backed = component as unknown as F32Backed;
            backed.writeF32(this._f32!, off);
            backed.bindF32(this._f32!, off);
        }
        // Appends land at the tail, so only the last block is dirtied -- this is what
        // lets a few hundred arrivals stop waking an archetype of tens of thousands.
        this.markBlockAt(index, time.elapsedTime);
    }

    /**
     * Drop the tail element.
     *
     * Deliberately does NOT touch `lastUpdatedTime`. That timestamp means "a
     * surviving element's *value* changed"; removing the last element changes no
     * survivor's value. Membership changes are already reported through the
     * archetype's `lastStructuralChangeTime`, which is what `filterLastUpdated`
     * consults by default.
     *
     * Bumping it here made every column look modified on any removal, so
     * `structuralFilter: "additions"` could never take effect and every
     * derived-data system rebuilt its whole archetype whenever one entity retired.
     */
    public removeLast(_time: { elapsedTime: number }) {
        const removed = this._componentData.pop();
        if (this._f32Width > 0 && removed !== undefined) {
            // the instance leaves the column: give it its own buffer (values
            // preserved) so an outstanding handle — or an archetype move about
            // to re-add it elsewhere — cannot scribble on the recycled slot
            (removed as unknown as F32Backed).detachF32();
        }
    }

    public removeAll(time: { elapsedTime: number }) {
        if (this._f32Width > 0) {
            const data = this._componentData;
            for (let i = 0; i < data.length; i++) (data[i] as unknown as F32Backed).detachF32();
        }
        this._componentData.length = 0;
        this._blockTimes.fill(0);
        this._lastUpdatedTime = time.elapsedTime;
    }

    public get(index: number): ComponentOf<CT> {
        return this._componentData[index];
    }

    public set(index: number, value: ComponentOf<CT>, time: { elapsedTime: number }) {
        const old = this._componentData[index];
        this._componentData[index] = value;
        if (this._f32Width > 0) {
            const off = index * this._f32Width;
            if (old !== undefined && old !== value) (old as unknown as F32Backed).detachF32();
            const backed = value as unknown as F32Backed;
            // same-instance re-set copies its own view onto itself — harmless
            backed.writeF32(this._f32!, off);
            backed.bindF32(this._f32!, off);
        }
        this.markBlockAt(index, time.elapsedTime);
    }
}

export class EntityArchetype<CT extends ComponentType<any> = ComponentType<any>> {
    private readonly _componentData: ComponentStore<CT>[];
    private _componentTypes: Map<CT, number>;
    private readonly _uniqueTypes: CT[]
    /**
     * Dense array of entity handles, parallel to every component column. The
     * reverse mapping (entity -> row) lives in the global registry (ownership.ts,
     * one row slot per entity index), which is what a sparse-set's sparse half
     * would be — an entity is in exactly one archetype, so one global column
     * serves every archetype at once.
     */
    private _entities: Entity[] = [];
    // entities after this index are disabled
    private _enabledCount: number = 0;

    private _lastStructuralChange: number = 0; // when an entry gets added/deleted

    /**
     * When an entity last *appeared* here (added, or enabled into the live range).
     * Removals do not bump this.
     *
     * Why the distinction: entities are swap-removed, and every column swaps
     * together, so a removal leaves every remaining entity's data correctly paired
     * and its derived values still valid. A system that computes per-entity data
     * from that entity's own components therefore has no work to do after a
     * removal — only after an addition.
     *
     * Treating the two the same is expensive: with 40k entities in one archetype,
     * removing a single one made LocalToWorldSystem recompute all 40k (0.09ms ->
     * 4.92ms), and four systems each paid it every frame entities were retiring.
     */
    private _lastEntityAdded: number = 0;

    /**
     * Count of enabled entities in this archetype.
     */
    public get entityCount(): number {
        return this._enabledCount;
    }

    /**
     * Count of entities in this archetype, including disabled ones.
     */
    public get entityCountUnfiltered(): number {
        return this._entities.length;
    }

    public get lastStructuralChangeTime(): number {
        return this._lastStructuralChange;
    }

    /** When an entity last appeared here. Removals do not bump this. */
    public get lastEntityAddedTime(): number {
        return this._lastEntityAdded;
    }

    public getColumn(token: CT) {
        const index = this._componentTypes.get(token);
        if (index === undefined || index === -1) return;
        return this._componentData[index];
    }

    public constructor(types: CT[]) {
        const seen = new Set<CT>();
        const uniqueTypes = types.filter(t => (seen.has(t) ? false : (seen.add(t) || true)));
        const map = new Map<CT, number>();
        for (let i = 0; i < uniqueTypes.length; i++) {
            map.set(uniqueTypes[i], i);
        }
        this._componentTypes = map;
        this._componentData = uniqueTypes.map(t => new ComponentStore<CT>(t));
        this._uniqueTypes = uniqueTypes;
    }

    public addEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean | undefined, time: {
        elapsedTime: number
    }) {
        const nextIndex = this._entities.length;
        this._entities.push(entity);
        setEntityRow(entity, nextIndex);
        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].add(component, time);
        });

        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(nextIndex, enabled, time);
        }

        this._lastStructuralChange = time.elapsedTime;
        this._lastEntityAdded = time.elapsedTime;
    }

    public setEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean | undefined, time: {
        elapsedTime: number
    }) {
        const index = this.getIndexOfEntity(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(index, enabled, time);
        }

        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].set(index, component, time);
        });

        this._lastStructuralChange = time.elapsedTime;
        this._lastEntityAdded = time.elapsedTime;
    }

    public removeAll(time: { elapsedTime: number }) {
        for (let i = 0; i < this._entities.length; i++) setEntityRow(this._entities[i], -1);
        this._entities.length = 0;
        this._enabledCount = 0;
        this._componentData.forEach((component) => component.removeAll(time));
        this._lastStructuralChange = time.elapsedTime;
    }

    public removeEntity(entity: Entity, time: { elapsedTime: number }) {
        const index = this.getIndexOfEntity(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        const wasEnabled = this.isEntityIndexEnabled(index);
        const lastIndex = this._entities.length - 1;

        this.swapDataAtIndices(index, lastIndex);

        // remove last (the swap moved `entity` to the tail)
        this._entities.length = lastIndex;
        setEntityRow(entity, -1);
        this._componentData.forEach((component) => component.removeLast(time))
        this._lastStructuralChange = time.elapsedTime;
        if (wasEnabled) this._enabledCount--;
    }

    /** Mark the block holding `index` dirty in every column. */
    private markAllColumnsAt(index: number, time: number) {
        const cols = this._componentData;
        for (let i = 0; i < cols.length; i++) cols[i].markBlockAt(index, time);
    }

    private swapDataAtIndices(a: number, b: number) {
        if (a === b) return;
        this._componentData.forEach(col => {
            col.swapValues(a, b);
        });
        const ents = this._entities;
        const ea = ents[a], eb = ents[b];
        ents[a] = eb;
        ents[b] = ea;
        setEntityRow(ea, b);
        setEntityRow(eb, a);
    }

    setEnabledStateForAll(enabled: boolean, time: { elapsedTime: number }) {
        if (enabled) this._enabledCount = this._entities.length;
        else this._enabledCount = 0;
        this._lastStructuralChange = time.elapsedTime;
        if (enabled) {
            this._lastEntityAdded = time.elapsedTime;   // entities entered the live range
            // No data moved, but every block just gained visible entities, so block
            // timestamps alone would not wake an "additions" system. Bulk operation,
            // so a whole-column stamp is the cheap correct answer.
            for (const col of this._componentData) col.lastUpdatedTime = time.elapsedTime;
        }
    }

    public setEnabledState(entity: Entity, enabled: boolean, time: { elapsedTime: number }): boolean {
        const entityIndex = this.getIndexOfEntity(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.setEnabledStateAtIndex(entityIndex, enabled, time);
    }

    public setEnabledStateAtIndex(index: number, enabled: boolean, time: { elapsedTime: number }): boolean {
        if (index < 0 || index >= this._entities.length) throw new Error("Index out of bounds");
        // merge the two functions
        let boundary: number;
        if (enabled) {
            if (index < this._enabledCount) return false; // already enabled
            boundary = this._enabledCount;
            this.swapDataAtIndices(index, boundary);
            this._enabledCount++;
        } else {
            if (index >= this._enabledCount) return false; // already disabled
            boundary = this._enabledCount - 1;
            this.swapDataAtIndices(index, boundary);
            this._enabledCount--;
        }
        this._lastStructuralChange = time.elapsedTime;
        // The swap moved two entities' data, so both blocks are stale.
        this.markAllColumnsAt(index, time.elapsedTime);
        this.markAllColumnsAt(boundary, time.elapsedTime);
        if (enabled) this._lastEntityAdded = time.elapsedTime;   // entered the live range
        return true;
    }

    public isEntityEnabled(entity: Entity): boolean {
        const entityIndex = this.getIndexOfEntity(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.isEntityIndexEnabled(entityIndex);
    }

    public isEntityIndexEnabled(index: number): boolean {
        if (index < 0 || index >= this._entities.length) throw new Error("Index out of bounds");
        return index < this._enabledCount;
    }

    public getIndexOfEntity(entity: Entity): number | undefined {
        // The registry row is trusted only if this archetype's dense array agrees:
        // that one comparison rejects rows belonging to another archetype AND
        // stale handles (the dense array stores full generation-carrying handles).
        const row = getEntityRow(entity);
        if (row < 0 || row >= this._entities.length) return undefined;
        return this._entities[row] === entity ? row : undefined;
    }

    public getDataAtEntityUntracked(entity: Entity): Map<CT, ComponentOf<CT>> {
        const entityIndex = this.getIndexOfEntity(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.getDataAtIndexUntracked(entityIndex);
    }

    public getDataAtEntity(entity: Entity): Map<CT, ComponentOf<CT>> {
        const entityIndex = this.getIndexOfEntity(entity);
        if (entityIndex === undefined) throw new Error(`invalid entity ${getEntityName(entity) ?? entity}`);
        return this.getDataAtIndex(entityIndex);
    }

    public getDataAtIndexUntracked(index: number): Map<CT, ComponentOf<CT>> {
        const map = new Map<CT, ComponentOf<CT>>();
        this._uniqueTypes.forEach((type, idx) => {
            const comp = this._componentData[idx].get(index);
            if (comp !== undefined) map.set(type, comp);
        });
        return map;
    }

    public getDataAtIndex(index: number): Map<CT, ComponentOf<CT>> {
        const map = new Map<CT, ComponentOf<CT>>();
        this._uniqueTypes.forEach((type, idx) => {
            const comp = this._componentData[idx].get(index);
            if (comp !== undefined) map.set(type, trackComponent(comp, () => this._componentData[idx].lastUpdatedTime = performance.now()));
        });
        return map;
    }

    public getEntityAtIndex(index: number): Entity {
        const entity = this._entities[index];
        if (entity === undefined) throw new Error("No entity found at index");
        return entity;
    }

    public get componentTypes(): readonly CT[] {
        return this._uniqueTypes;
    }

    /**
     * The dense entity-handle array, parallel to every column — row i belongs to
     * entityHandles[i]. For the column-span query path; do not mutate.
     */
    public get entityHandles(): readonly Entity[] {
        return this._entities;
    }
}
