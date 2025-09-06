import type {ComponentType} from "./component";
import {Event} from "../util/event";
import {EntityArchetype} from "./entityArchetype";

export class EntityArchetypeMap<CT extends ComponentType<any> = ComponentType<any>> {
  private _byKey: Map<string, EntityArchetype<CT>> = new Map();
  private _typeIds: WeakMap<CT, number> = new WeakMap();
  private _nextTypeId = 1;

  public get totalCount(): number {
    return this._byKey.size;
  }

  public get totalEmpty(): number {
    return Array.from(this._byKey.values()).filter(arch => arch.entityCount === 0).length;
  }

  public onCreateArchtype: Event<EntityArchetype<CT>> = new Event();

  private keyFor(types: CT[]): string {
    const ids = types.map(t => {
      let id = this._typeIds.get(t);
      if (!id) {
        id = this._nextTypeId++;
        this._typeIds.set(t, id);
      }
      return id;
    });
    const uniqueSorted = Array.from(new Set(ids)).sort((a, b) => a - b);
    return uniqueSorted.join("|");
  }

  public getOrCreate(componentTypes: CT[]): EntityArchetype<CT> {
    const key = this.keyFor(componentTypes);
    let arch = this._byKey.get(key);
    if (!arch) {
      const uniqTypes = Array.from(new Set(componentTypes));
      arch = new EntityArchetype<CT>(uniqTypes);
      this._byKey.set(key, arch);
      this.onCreateArchtype.invoke(arch);
    }
    return arch;
  }

  public get(componentTypes: CT[]): EntityArchetype<CT> | undefined {
    return this._byKey.get(this.keyFor(componentTypes));
  }

  public* values(): IterableIterator<EntityArchetype<CT>> {
    yield* this._byKey.values();
  }
}
