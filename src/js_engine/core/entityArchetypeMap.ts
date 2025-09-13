import type {ComponentType} from "./component";
import {Event} from "../util/event";
import {EntityArchetype} from "./entityArchetype";
import Iterator = NodeJS.Iterator;

export class EntityArchetypeMap<CT extends ComponentType<any> = ComponentType<any>> {
  private _byKey: Map<string, WeakRef<EntityArchetype<CT>>> = new Map();
  private _typeIds: WeakMap<CT, number> = new WeakMap();
  private _nextTypeId = 1;


  public get loadedArchetypes(): number {
    return this._byKey.size;
  }

  public onCreateArchetype: Event<EntityArchetype<CT>> = new Event();

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
    const arch = this._byKey.get(key)?.deref();
    if (arch) return arch

    const uniqTypes = Array.from(new Set(componentTypes));
    const archetype = new EntityArchetype<CT>(uniqTypes);
    this._byKey.set(key, new WeakRef(archetype));
    this.onCreateArchetype.invoke(archetype);
    return archetype;
  }

  public* values(): Iterator<EntityArchetype<CT>> {
    const kvPair = this._byKey.entries();
    for (const [key, value] of kvPair) {
      const arch = value.deref()
      if (arch) yield arch;
      else this._byKey.delete(key);
    }
  }
}
