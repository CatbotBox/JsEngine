import type {ComponentType, ComponentOf} from "./component";
import {DoubleMap} from "../util/doubleMap";
import {Entity} from "./entity";

export class ComponentStore<CT extends ComponentType<any>> {
    private readonly _componentData: ComponentOf<CT>[] = [];

    public swapValues(indexA: number, indexB: number) {
        const data = this._componentData;
        const temp = data[indexA];
        data[indexA] = data[indexB];
        data[indexB] = temp;
    }

    public add(component: ComponentOf<CT>) {
        this._componentData.push(component);
    }

    public removeLast() {
        this._componentData.length -= 1;
    }

    public removeAll() {
        this._componentData.length = 0;
    }

    public get(index: number): ComponentOf<CT> {
        return this._componentData[index];
    }

    public set(index: number, value: ComponentOf<CT>) {
        this._componentData[index] = value
    }
}

export class EntityArchetype<CT extends ComponentType<any> = ComponentType<any>> {
    private readonly _componentData: ComponentStore<CT>[];
    private _componentTypes: Map<CT, number>;
    private readonly _uniqueTypes: CT[]
    private _entities: DoubleMap<Entity, number> = new DoubleMap();
    // entities after this index are disabled
    private _enabledCount: number = 0;

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

    public addEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled: boolean) {
        const nextIndex = this._entities.size;
        this._entities.set(entity, nextIndex);
        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].add(component);
        });

        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(nextIndex, enabled);
        }
    }

    public setEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>, enabled?: boolean) {
        const index = this._entities.getValue(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        if (enabled !== undefined) {
            this.setEnabledStateAtIndex(index, enabled);
        }

        this._uniqueTypes.forEach((type, idx) => {
            const component = components.get(type);
            if (!component) throw new Error("component of required type is missing");
            this._componentData[idx].set(index, component);
        });
    }

    public removeAll() {
        this._entities.clear();
        this._componentData.forEach((component) => component.removeAll())
    }

    public removeEntity(entity: Entity) {
        const index = this._entities.getValue(entity);
        if (index === undefined) throw new Error("Entity does not exist");

        const wasEnabled = this.isEntityIndexEnabled(index);
        const lastIndex = this._entities.size - 1;

        this.swapDataAtIndices(index, lastIndex);

        // remove last
        this._entities.deleteKey(entity);
        this._componentData.forEach((component) => component.removeLast())
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

    setEnabledStateForAll(enabled: boolean) {
        if (enabled) this._enabledCount = this._entities.size;
        else this._enabledCount = 0;
    }

    public setEnabledState(entity: Entity, enabled: boolean) {
        const entityIndex = this._entities.getValue(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        this.setEnabledStateAtIndex(entityIndex, enabled);
    }

    public setEnabledStateAtIndex(index: number, enabled: boolean) {
        if (index < 0 || index >= this._entities.size) throw new Error("Index out of bounds");
        // merge the two functions
        if (enabled) {
            if (index < this._enabledCount) return; // already enabled
            this.swapDataAtIndices(index, this._enabledCount);
            this._enabledCount++;
        } else {
            if (index >= this._enabledCount) return; // already disabled
            this.swapDataAtIndices(index, this._enabledCount - 1);
            this._enabledCount--;
        }
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

    public getDataAtEntity(entity: Entity): Map<CT, ComponentOf<CT>> {
        const entityIndex = this._entities.getValue(entity);
        if (entityIndex === undefined) throw new Error("invalid entity");
        return this.getDataAtIndex(entityIndex);
    }

    public getDataAtIndex(index: number): Map<CT, ComponentOf<CT>> {
        const map = new Map<CT, ComponentOf<CT>>();
        this._uniqueTypes.forEach((type, idx) => {
            const comp = this._componentData[idx].get(index);
            if (comp !== undefined) map.set(type, comp);
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
