import type {ComponentType} from "./component";
import {Event} from "../util/event";
import {EntityArchetype} from "./entityArchetype";
import Iterator = NodeJS.Iterator;

class TypeIDProvider<CT extends ComponentType<any> = ComponentType<any>> {
  private _typeIds: WeakMap<CT, number> = new WeakMap();
  private _nextTypeId = 1;

  public getKey(types: CT[]): string {
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
}

export class EntityArchetypeMap<CT extends ComponentType<any> = ComponentType<any>> {
  private _byKey: Map<string, WeakRef<EntityArchetype<CT>>> = new Map();
  private _keepInRefList: EntityArchetype<CT>[] = []; //todo temp fix
  private _typeIdProvider: TypeIDProvider<CT> = new TypeIDProvider<CT>();

  public get loadedArchetypes(): number {
    return this._byKey.size;
  }

  public onCreateArchetype: Event<EntityArchetype<CT>> = new Event();

  public getOrCreate(componentTypes: CT[]): EntityArchetype<CT> {
    const key = this._typeIdProvider.getKey(componentTypes);
    const arch = this._byKey.get(key)?.deref();
    if (arch) return arch

    const uniqTypes = Array.from(new Set(componentTypes));
    const archetype = new EntityArchetype<CT>(uniqTypes);
    this._byKey.set(key, new WeakRef(archetype));
    this.onCreateArchetype.invoke(archetype);
    this._keepInRefList.push(archetype);
    return archetype;
  }

  public prune(): number {
    const newList = this._keepInRefList
      .sort((a, b) => a.entityCount - b.entityCount)
      .reverse();
    const pruneAtIndex = newList.findIndex(a => a.entityCount == 0);
    if (pruneAtIndex == -1) return 0;
    const pruneCount = newList.length - pruneAtIndex;
    newList.length = pruneAtIndex;
    this._keepInRefList = newList;
    return pruneCount;
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
