import {ComponentType, ComponentOf, Component, ComponentCtor} from "./component";
import type {F32Backed} from "./componentType";
import {persistentTrackComponent} from "./trackedComponent";
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
        if (id === undefined) return undefined;
        const component = componentStore.get(id);
        if (readonly) return component;
        return persistentTrackComponent(entity, component);
    }
}

export const BLOCK_SHIFT = 7;
export const BLOCK_SIZE = 1 << BLOCK_SHIFT;
export const NO_SOURCE_COLUMN = -1;

const INITIAL_F32_ROWS = 8;
const F32_COLUMN_GROWTH_FACTOR = 4;
const INITIAL_BLOCK_CAPACITY = 8;

export class ComponentStore<CT extends ComponentType<any>> {
    private readonly _componentData: ComponentOf<CT>[] = [];

    private _f32: Float32Array | undefined;
    private _rowViews: Float32Array[] = [];
    private readonly _f32Width: number;

    constructor(token?: CT) {
        this._f32Width = token?.f32Width ?? 0;
        if (this._f32Width > 0) this._f32 = new Float32Array(INITIAL_F32_ROWS * this._f32Width);
    }

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
        let cap = cur.length || INITIAL_F32_ROWS * width;
        while (cap < count * width) cap *= F32_COLUMN_GROWTH_FACTOR;
        const grown = new Float32Array(cap);
        grown.set(cur);
        this._f32 = grown;
        const data = this._componentData, views = this._rowViews;
        for (let i = 0; i < data.length; i++) {
            const view = grown.subarray(i * width, i * width + width);
            views[i] = view;
            (data[i] as unknown as F32Backed).bindF32(view);
        }
        views.length = data.length;
    }

    private rowView(row: number): Float32Array {
        const views = this._rowViews;
        const cached = row < views.length ? views[row] : undefined;
        if (cached !== undefined) return cached;
        const offset = row * this._f32Width;
        const view = this._f32!.subarray(offset, offset + this._f32Width);
        views[row] = view;
        return view;
    }

    private _lastUpdatedTime: number = 0;

    private _blockTimes = new Float64Array(INITIAL_BLOCK_CAPACITY);

    public get lastUpdatedTime(): number {
        return this._lastUpdatedTime;
    }

    public set lastUpdatedTime(value: number) {
        if (this._lastUpdatedTime > value) return;
        this._lastUpdatedTime = value;
        this._blockTimes.fill(value, 0, this.blockCount);
    }

    public get blockCount(): number {
        return (this._componentData.length + BLOCK_SIZE - 1) >> BLOCK_SHIFT;
    }

    private ensureBlocks(count: number) {
        if (count <= this._blockTimes.length) return;
        let cap = this._blockTimes.length || INITIAL_BLOCK_CAPACITY;
        while (cap < count) cap *= 2;
        const grown = new Float64Array(cap);
        grown.set(this._blockTimes);
        this._blockTimes = grown;
    }

    public markBlockAt(index: number, time: number) {
        const b = index >> BLOCK_SHIFT;
        this.ensureBlocks(b + 1);
        if (this._blockTimes[b] < time) this._blockTimes[b] = time;
        if (this._lastUpdatedTime < time) this._lastUpdatedTime = time;
    }

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
            const f = this._f32!;
            const a = indexA * width, b = indexB * width;
            for (let k = 0; k < width; k++) {
                const t = f[a + k];
                f[a + k] = f[b + k];
                f[b + k] = t;
            }
            (data[indexA] as unknown as F32Backed).bindF32(this.rowView(indexA));
            (data[indexB] as unknown as F32Backed).bindF32(this.rowView(indexB));
        }
    }

    public add(component: ComponentOf<CT>, time: number) {
        const index = this._componentData.length;
        if (this._f32Width > 0) {
            this.ensureF32Capacity(index + 1);
        }
        this._componentData.push(component);
        if (this._f32Width > 0) {
            const off = index * this._f32Width;
            const backed = component as unknown as F32Backed;
            backed.writeF32(this._f32!, off);
            backed.bindF32(this.rowView(index));
        }
        this.markBlockAt(index, time);
    }

    public addFrom(source: ComponentStore<CT>, row: number, time: number) {
        const index = this._componentData.length;
        const component = source._componentData[row];
        const width = this._f32Width;
        if (width > 0) this.ensureF32Capacity(index + 1);
        this._componentData.push(component);
        if (width > 0) {
            const dst = this._f32!, src = source._f32!;
            const off = index * width, srcOff = row * width;
            for (let k = 0; k < width; k++) dst[off + k] = src[srcOff + k];
            (component as unknown as F32Backed).bindF32(this.rowView(index));
        }
        this.markBlockAt(index, time);
    }

    public moveValue(from: number, to: number) {
        const data = this._componentData;
        const component = data[from];
        data[to] = component;
        const width = this._f32Width;
        if (width > 0) {
            const f = this._f32!;
            const a = from * width, b = to * width;
            for (let k = 0; k < width; k++) f[b + k] = f[a + k];
            (component as unknown as F32Backed).bindF32(this.rowView(to));
        }
    }

    public detachAt(index: number) {
        if (this._f32Width > 0) (this._componentData[index] as unknown as F32Backed).detachF32();
    }

    public dropLast() {
        this._componentData.pop();
    }

    public removeAll(time: number) {
        if (this._f32Width > 0) {
            const data = this._componentData;
            for (let i = 0; i < data.length; i++) (data[i] as unknown as F32Backed).detachF32();
        }
        this._componentData.length = 0;
        this._blockTimes.fill(0);
        this._lastUpdatedTime = time;
    }

    public get(index: number): ComponentOf<CT> {
        return this._componentData[index];
    }

    public set(index: number, value: ComponentOf<CT>, time: number) {
        const old = this._componentData[index];
        this._componentData[index] = value;
        if (this._f32Width > 0) {
            const off = index * this._f32Width;
            if (old !== undefined && old !== value) (old as unknown as F32Backed).detachF32();
            const backed = value as unknown as F32Backed;
            backed.writeF32(this._f32!, off);
            backed.bindF32(this.rowView(index));
        }
        this.markBlockAt(index, time);
    }
}

function mapsColumn(columnMap: Int32Array, mappedColumns: number, column: number): boolean {
    for (let i = 0; i < mappedColumns; i++) if (columnMap[i] === column) return true;
    return false;
}

export interface ArchetypeEdge<CT extends ComponentType<any> = ComponentType<any>> {
    readonly target: EntityArchetype<CT>;
    readonly columnMap: Int32Array;
}

export class EntityArchetype<CT extends ComponentType<any> = ComponentType<any>> {
    public readonly addEdges: Map<CT, ArchetypeEdge<CT>> = new Map();
    public readonly removeEdges: Map<CT, ArchetypeEdge<CT>> = new Map();
    private readonly _componentData: ComponentStore<CT>[];
    private _componentTypes: Map<CT, number>;
    private readonly _uniqueTypes: CT[]
    public readonly sortedTypeIds: Int32Array;
    private _entities: Entity[] = [];
    private _enabledCount: number = 0;

    private _lastStructuralChangeTime: number = 0;

    private _lastEntityAddedTime: number = 0;

    public get enabledEntityCount(): number {
        return this._enabledCount;
    }

    public get entityCountIncludingDisabled(): number {
        return this._entities.length;
    }

    public get lastStructuralChangeTime(): number {
        return this._lastStructuralChangeTime;
    }

    public get lastEntityAddedTime(): number {
        return this._lastEntityAddedTime;
    }

    public columnIndexOf(token: CT): number {
        return this._componentTypes.get(token) ?? NO_SOURCE_COLUMN;
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
        this.sortedTypeIds = Int32Array.from(uniqueTypes, t => t.id).sort();
    }

    public addEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean | undefined, time: {
        elapsedTimeMs: number
    }) {
        const now = time.elapsedTimeMs;
        const row = this.pushEntity(entity);
        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].add(component, now);
        });
        this.commitAppendedRow(row, enabled, now);
    }

    public addEntityFromList(entity: Entity, tokens: readonly CT[], components: readonly ComponentOf<CT>[], enabled: boolean | undefined, time: {
        elapsedTimeMs: number
    }) {
        const now = time.elapsedTimeMs;
        const row = this.pushEntity(entity);
        const types = this._uniqueTypes, cols = this._componentData;
        for (let i = 0; i < types.length; i++) {
            const at = tokens.indexOf(types[i]);
            if (at < 0) throw new Error("component of required type is missing");
            cols[i].add(components[at], now);
        }
        this.commitAppendedRow(row, enabled, now);
    }

    public moveRowTo(entity: Entity, target: EntityArchetype<CT>, edge: ArchetypeEdge<CT>, added: ComponentOf<CT> | undefined, time: {
        elapsedTimeMs: number
    }) {
        const now = time.elapsedTimeMs;
        const row = this.getIndexOfEntity(entity);
        if (row === undefined) throw new Error("Entity does not exist");
        const columnMap = edge.columnMap;
        if (columnMap.length < this._componentData.length) this.detachDroppedAt(row, columnMap, columnMap.length);
        target.appendRowFrom(entity, this, row, columnMap, added, undefined, row < this._enabledCount, now);
        this.vacateRow(row);
        this._lastStructuralChangeTime = now;
    }

    public moveRowWith(entity: Entity, target: EntityArchetype<CT>, columnMap: Int32Array, supplied: readonly (ComponentOf<CT> | undefined)[], time: {
        elapsedTimeMs: number
    }) {
        if (target === this) throw new Error("moveRowWith needs a different archetype; rewrite the row in place instead");
        const now = time.elapsedTimeMs;
        const row = this.getIndexOfEntity(entity);
        if (row === undefined) throw new Error("Entity does not exist");
        this.detachDroppedAt(row, columnMap, target._componentData.length);
        target.appendRowFrom(entity, this, row, columnMap, undefined, supplied, row < this._enabledCount, now);
        this.vacateRow(row);
        this._lastStructuralChangeTime = now;
    }

    private appendRowFrom(entity: Entity, source: EntityArchetype<CT>, sourceRow: number, columnMap: Int32Array, added: ComponentOf<CT> | undefined, supplied: readonly (ComponentOf<CT> | undefined)[] | undefined, enabled: boolean, now: number) {
        const row = this.pushEntity(entity);
        const cols = this._componentData, sourceCols = source._componentData;
        for (let i = 0; i < cols.length; i++) {
            const from = columnMap[i];
            if (from >= 0) {
                cols[i].addFrom(sourceCols[from], sourceRow, now);
                continue;
            }
            const component = supplied !== undefined ? supplied[i] : added;
            if (component === undefined) throw new Error("component of required type is missing");
            cols[i].add(component, now);
        }
        this.commitAppendedRow(row, enabled, now);
    }

    private detachDroppedAt(row: number, columnMap: Int32Array, mappedColumns: number) {
        const cols = this._componentData;
        for (let i = 0; i < cols.length; i++) {
            if (cols[i].f32Width > 0 && !mapsColumn(columnMap, mappedColumns, i)) cols[i].detachAt(row);
        }
    }

    private pushEntity(entity: Entity): number {
        const row = this._entities.length;
        this._entities.push(entity);
        setEntityRow(entity, row);
        return row;
    }

    private commitAppendedRow(row: number, enabled: boolean | undefined, now: number) {
        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(row, enabled, now);
        }

        this._lastStructuralChangeTime = now;
        this._lastEntityAddedTime = now;
    }

    public setEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean | undefined, time: {
        elapsedTimeMs: number
    }) {
        const index = this.getIndexOfEntity(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        const now = time.elapsedTimeMs;
        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(index, enabled, now);
        }

        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].set(index, component, now);
        });

        this._lastStructuralChangeTime = now;
        this._lastEntityAddedTime = now;
    }

    public removeAll(time: { elapsedTimeMs: number }) {
        const now = time.elapsedTimeMs;
        for (let i = 0; i < this._entities.length; i++) setEntityRow(this._entities[i], -1);
        this._entities.length = 0;
        this._enabledCount = 0;
        this._componentData.forEach((component) => component.removeAll(now));
        this._lastStructuralChangeTime = now;
    }

    public removeEntity(entity: Entity, time: { elapsedTimeMs: number }) {
        const index = this.getIndexOfEntity(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        const cols = this._componentData;
        for (let i = 0; i < cols.length; i++) cols[i].detachAt(index);
        setEntityRow(entity, -1);
        this.vacateRow(index);
        this._lastStructuralChangeTime = time.elapsedTimeMs;
    }

    private vacateRow(row: number) {
        const last = this._entities.length - 1;
        if (row < this._enabledCount) {
            const lastEnabled = --this._enabledCount;
            this.moveRowWithin(lastEnabled, row);
            this.moveRowWithin(last, lastEnabled);
        } else {
            this.moveRowWithin(last, row);
        }
        this._entities.length = last;
        const cols = this._componentData;
        for (let i = 0; i < cols.length; i++) cols[i].dropLast();
    }

    private moveRowWithin(from: number, to: number) {
        if (from === to) return;
        const cols = this._componentData;
        for (let i = 0; i < cols.length; i++) cols[i].moveValue(from, to);
        const moved = this._entities[from];
        this._entities[to] = moved;
        setEntityRow(moved, to);
    }

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

    setEnabledStateForAll(enabled: boolean, time: { elapsedTimeMs: number }) {
        const now = time.elapsedTimeMs;
        if (enabled) this._enabledCount = this._entities.length;
        else this._enabledCount = 0;
        this._lastStructuralChangeTime = now;
        if (enabled) {
            this._lastEntityAddedTime = now;
            for (const col of this._componentData) col.lastUpdatedTime = now;
        }
    }

    public setEnabledState(entity: Entity, enabled: boolean, time: { elapsedTimeMs: number }): boolean {
        const entityIndex = this.getIndexOfEntity(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.setEnabledStateAtIndex(entityIndex, enabled, time.elapsedTimeMs);
    }

    public setEnabledStateAtIndex(index: number, enabled: boolean, timestamp: number): boolean {
        if (index < 0 || index >= this._entities.length) throw new Error("Index out of bounds");
        let boundary: number;
        if (enabled) {
            if (index < this._enabledCount) return false;
            boundary = this._enabledCount;
            this.swapDataAtIndices(index, boundary);
            this._enabledCount++;
        } else {
            if (index >= this._enabledCount) return false;
            boundary = this._enabledCount - 1;
            this.swapDataAtIndices(index, boundary);
            this._enabledCount--;
        }
        this._lastStructuralChangeTime = timestamp;
        this.markAllColumnsAt(index, timestamp);
        this.markAllColumnsAt(boundary, timestamp);
        if (enabled) this._lastEntityAddedTime = timestamp;
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
        const entity = this._entities[index];
        this._uniqueTypes.forEach((type, idx) => {
            const comp = this._componentData[idx].get(index);
            if (comp !== undefined) map.set(type, persistentTrackComponent(entity, comp));
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

    public get entityHandles(): readonly Entity[] {
        return this._entities;
    }
}
