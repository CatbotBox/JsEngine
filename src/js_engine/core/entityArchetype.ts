import type {ComponentType, ComponentOf} from "./component";
import {DoubleMap} from "../util/doubleMap";
import {Entity} from "./entity";

export class EntityArchetype<CT extends ComponentType<any> = ComponentType<any>> {
  private _components: ComponentOf<CT>[][];
  private _componentTypes: CT[];
  private _entities: DoubleMap<Entity, number> = new DoubleMap();

  public get entityCount(): number {
    return this._entities.size;
  }

  public constructor(types: CT[]) {
    // dedupe, preserve first-appearance order
    const seen = new Set<CT>();
    this._componentTypes = types.filter(t => (seen.has(t) ? false : (seen.add(t), true)));
    this._components = Array.from({length: this._componentTypes.length}, () => []);
  }

  public addEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>) {
    const nextIndex = this._entities.size;
    this._entities.set(entity, nextIndex);

    this._componentTypes.forEach((type, idx) => {
      const component = components.get(type);
      if (!component) throw new Error("component of required type is missing");
      if (this._components[idx].length > nextIndex) {
        this._components[idx][nextIndex] = component as ComponentOf<CT>;
      } else {
        this._components[idx].push(component as ComponentOf<CT>);
      }
    });
  }

  public setEntity(entity: Entity, components: Map<CT, ComponentOf<CT>>) {
    const index = this._entities.getValue(entity);
    if (index === undefined) throw new Error("Entity does not exist");

    this._componentTypes.forEach((type, idx) => {
      const component = components.get(type);
      if (!component) throw new Error("component of required type is missing");
      this._components[idx][index] = component as ComponentOf<CT>;
    });
  }

  public removeAll() {
  this._entities.clear();
  }

  public removeEntity(entity: Entity) {
    const index = this._entities.getValue(entity);
    if (index === undefined) throw new Error("Entity does not exist");

    const lastIndex = this._entities.size - 1;

    if (index !== lastIndex) {
      const lastEntity = this._entities.getKey(lastIndex);
      if (lastEntity !== undefined) {
        this._components.forEach(col => {
          col[index] = col[lastIndex];
        });
        this._entities.deleteValue(lastIndex);
        this._entities.deleteKey(entity);
        this._entities.set(lastEntity, index);
      } else {
        this._entities.deleteKey(entity);
      }
    } else {
      this._entities.deleteKey(entity);
      this._entities.deleteValue(lastIndex);
    }
  }

  public getDataAtEntity(entity: Entity): Map<CT, ComponentOf<CT>> {
    const entityIndex = this._entities.getValue(entity);
    if (entityIndex === undefined) throw new Error("invalid entity");
    return this.getDataAtIndex(entityIndex);
  }

  public getDataAtIndex(index: number): Map<CT, ComponentOf<CT>> {
    const map = new Map<CT, ComponentOf<CT>>();
    this._componentTypes.forEach((type, idx) => {
      const comp = this._components[idx][index];
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
    return this._componentTypes;
  }
}
