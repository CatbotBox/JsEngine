import {ComponentType, ComponentOf, Component, ComponentCtor} from "./component";
import {DoubleMap} from "../util/doubleMap";
import {Entity} from "./entity";
import {EntityQuery} from "./entityQuery";
import {AnyCT} from "../util/tokenUtils";
import {getOwner} from "./ownership";
import {WorldSource} from "./worldSource";

export class ComponentLookup<T extends Component, CT extends ComponentType<T> = ComponentType<T>, MISC extends AnyCT[] = []> {
    private readonly _token: ComponentType<T>
    // private _stores: Map<EntityArchetype, ComponentStore<CT>> = new Map();
    private _options?: { filterLastUpdated: number | undefined }

    constructor(private _worldSource: WorldSource, componentType: ComponentCtor<T>, private _sourceQuery: EntityQuery<[...MISC,CT, ...MISC]> = new EntityQuery(this._worldSource, [componentType])) {
        this._token = ComponentType.of(componentType);
    }

    public update(options?: { filterLastUpdated: number | undefined }) {
        this._options = options;
    }

    public tryGetComponent(entity: Entity):ComponentOf<CT> | undefined {
        const archetype = getOwner(this._worldSource.world, entity);
        if (!archetype) return undefined;
        const componentStore = archetype.getColumn(this._token);
        if (!componentStore) return undefined;
        if (this._options && this._options.filterLastUpdated !== undefined &&
            (archetype.lastStructuralChangeTime > this._options.filterLastUpdated || componentStore.lastUpdatedTime > this._options.filterLastUpdated)) {
            return undefined;
        }
        const id = archetype.getIndexOfEntity(entity)!;
        return componentStore.get(id)!;
    }
}

export class ComponentStore<CT extends ComponentType<any>> {
    private readonly _componentData: ComponentOf<CT>[] = [];
    // all components with the same type in an archetype will share one lastUpdatedTime
    // they are in the same archetype so they would have been most likely all changed or all unchanged
    private _lastUpdatedTime: number = 0; // when values get updated

    public get lastUpdatedTime(): number {
        return this._lastUpdatedTime;
    }

    public set lastUpdatedTime(value: number) {
        if (this._lastUpdatedTime > value) return;
        this._lastUpdatedTime = value;
    }

    public swapValues(indexA: number, indexB: number) {
        const data = this._componentData;
        const temp = data[indexA];
        data[indexA] = data[indexB];
        data[indexB] = temp;
    }

    public add(component: ComponentOf<CT>, time: { elapsedTime: number }) {
        this._componentData.push(component);
        this._lastUpdatedTime = time.elapsedTime;

    }

    public removeLast(time: { elapsedTime: number }) {
        this._componentData.length -= 1;
        this._lastUpdatedTime = time.elapsedTime;
    }

    public removeAll(time: { elapsedTime: number }) {
        this._componentData.length = 0;
        this._lastUpdatedTime = time.elapsedTime;
    }

    public get(index: number): ComponentOf<CT> {
        return this._componentData[index];
    }

    public set(index: number, value: ComponentOf<CT>, time: { elapsedTime: number }) {
        this._componentData[index] = value;
        this._lastUpdatedTime = time.elapsedTime;
    }
}

export class EntityArchetype<CT extends ComponentType<any> = ComponentType<any>> {
    private readonly _componentData: ComponentStore<CT>[];
    private _componentTypes: Map<CT, number>;
    private readonly _uniqueTypes: CT[]
    private _entities: DoubleMap<Entity, number> = new DoubleMap();
    // entities after this index are disabled
    private _enabledCount: number = 0;

    private _lastStructuralChange: number = 0; // when an entry gets added/deleted

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
        return this._entities.size;
    }

    public get lastStructuralChangeTime(): number {
        return this._lastStructuralChange;
    }

    public getColumn(token: CT) {
        const index = this._componentTypes.get(token);
        if (index === undefined || index === -1) return;
        return this._componentData[index];
    }


    public constructor(types: CT[]) {
        // dedupe, preserve first-appearance order
        const seen = new Set<CT>();
        const uniqueTypes = types.filter(t => (seen.has(t) ? false : (seen.add(t) || true)));
        const map = new Map<CT, number>();
        for (let i = 0; i < uniqueTypes.length; i++) {
            map.set(uniqueTypes[i], i);
        }
        this._componentTypes = map;
        this._componentData = Array.from({length: uniqueTypes.length}, () => new ComponentStore<CT>());
        this._uniqueTypes = uniqueTypes;
    }

    public addEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean | undefined, time: {
        elapsedTime: number
    }) {
        const nextIndex = this._entities.size;
        this._entities.set(entity, nextIndex);
        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].add(component, time);
        });

        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(nextIndex, enabled, time);
        }

        this._lastStructuralChange = time.elapsedTime;
    }

    public setEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean | undefined, time: {
        elapsedTime: number
    }) {
        const index = this._entities.getValue(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(index, enabled, time);
        }

        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].set(index, component, time);
        });

        this._lastStructuralChange = time.elapsedTime
    }

    public removeAll(time: { elapsedTime: number }) {
        this._entities.clear();
        this._componentData.forEach((component) => component.removeAll(time));
        this._lastStructuralChange = time.elapsedTime;
    }

    public removeEntity(entity: Entity, time: { elapsedTime: number }) {
        const index = this._entities.getValue(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        const wasEnabled = this.isEntityIndexEnabled(index);
        const lastIndex = this._entities.size - 1;

        this.swapDataAtIndices(index, lastIndex);

        // remove last
        this._entities.deleteKey(entity);
        this._componentData.forEach((component) => component.removeLast(time))
        this._lastStructuralChange = time.elapsedTime;
        if (wasEnabled) this._enabledCount--;
    }

    private swapDataAtIndices(a: number, b: number) {
        if (a === b) return;
        this._componentData.forEach(col => {
            col.swapValues(a, b);
        });
        // swap entity ids
        this._entities.swapValues(a, b);
    }

    setEnabledStateForAll(enabled: boolean, time: { elapsedTime: number }) {
        if (enabled) this._enabledCount = this._entities.size;
        else this._enabledCount = 0;
        this._lastStructuralChange = time.elapsedTime;
    }

    public setEnabledState(entity: Entity, enabled: boolean, time: { elapsedTime: number }): boolean {
        const entityIndex = this._entities.getValue(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.setEnabledStateAtIndex(entityIndex, enabled, time);
    }

    public setEnabledStateAtIndex(index: number, enabled: boolean, time: { elapsedTime: number }): boolean {
        if (index < 0 || index >= this._entities.size) throw new Error("Index out of bounds");
        // merge the two functions
        if (enabled) {
            if (index < this._enabledCount) return false; // already enabled
            this.swapDataAtIndices(index, this._enabledCount);
            this._enabledCount++;
        } else {
            if (index >= this._enabledCount) return false; // already disabled
            this.swapDataAtIndices(index, this._enabledCount - 1);
            this._enabledCount--;
        }
        this._lastStructuralChange = time.elapsedTime;
        return true;
    }


    public isEntityEnabled(entity: Entity): boolean {
        const entityIndex = this._entities.getValue(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.isEntityIndexEnabled(entityIndex);
    }

    public isEntityIndexEnabled(index: number): boolean {
        if (index < 0 || index >= this._entities.size) throw new Error("Index out of bounds");
        return index < this._enabledCount;
    }

    public getIndexOfEntity(entity: Entity): number | undefined {
        return this._entities.getValue(entity);
    }

    public getDataAtEntity(entity: Entity): Map<CT, ComponentOf<CT>> {
        const entityIndex = this._entities.getValue(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.getDataAtIndex(entityIndex);
    }

    public getDataAtIndex(index: number): Map<CT, ComponentOf<CT>> {
        const map = new Map<CT, ComponentOf<CT>>();
        this._uniqueTypes.forEach((type, idx) => {
            const comp = this._componentData[idx].get(index);
            if (comp !== undefined) map.set(type, Component.track(comp, () => this._componentData[idx].lastUpdatedTime = performance.now()));
        });
        return map;
    }

    public getEntityAtIndex(index: number): Entity {
        const entity = this._entities.getKey(index);
        if (!entity) throw new Error("No entity found at index");
        return entity;
    }

    public get componentTypes(): readonly CT[] {
        return this._uniqueTypes;
    }
}
