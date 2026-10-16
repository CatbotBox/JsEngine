import {TokenOrCtor, toTokens} from "../util/tokenUtils";
import type {ComponentType} from "./component";
import {Event} from "../util/event";
import {ArchetypeEdge, EntityArchetype} from "./entityArchetype";

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

function buildColumnMap<CT extends ComponentType<any>>(source: EntityArchetype<CT>, target: EntityArchetype<CT>): Int32Array {
  const targetTypes = target.componentTypes;
  const map = new Int32Array(targetTypes.length);
  for (let i = 0; i < targetTypes.length; i++) map[i] = source.columnIndexOf(targetTypes[i]);
  return map;
}

export class EntityArchetypeMap<CT extends ComponentType<any> = ComponentType<any>> {
  private _byKey: Map<string, EntityArchetype<CT>> = new Map();
  private _typeIdProvider: TypeIDProvider<CT> = new TypeIDProvider<CT>();

  public get loadedArchetypes(): number {
    return this._byKey.size;
  }

  public onCreateArchetype: Event<EntityArchetype<CT>> = new Event();
  public onPruneArchetype: Event<EntityArchetype<CT>> = new Event();

  /**
   * Accepts tokens or constructors. Normalising matters: the id provider keys off
   * object identity, so a constructor and its ComponentType used to get different
   * ids and therefore *different archetypes* — silently, with no error. Passing a
   * constructor here would build a parallel empty archetype that never matched
   * anything.
   */
  public getOrCreate(types: readonly TokenOrCtor[]): EntityArchetype<CT> {
    const componentTypes = toTokens(types) as CT[];
    const key = this._typeIdProvider.getKey(componentTypes);
    const arch = this._byKey.get(key);
    if (arch) return arch

    const uniqTypes = Array.from(new Set(componentTypes));
    const archetype = new EntityArchetype<CT>(uniqTypes);
    this._byKey.set(key, archetype);
    this.onCreateArchetype.invoke(archetype);
    return archetype;
  }

  /** The edge from `from` to `from + token`. Throws if `from` already has `token`. */
  public withAdded(from: EntityArchetype<CT>, token: CT): ArchetypeEdge<CT> {
    const edge = from.addEdges.get(token);
    if (edge !== undefined) return edge;
    if (from.getColumn(token) !== undefined) throw new Error("archetype already has the component being added");

    this.link(from, this.getOrCreate([...from.componentTypes, token]), token);
    return from.addEdges.get(token)!;
  }

  /** The edge from `from` to `from - token`. Throws if `from` lacks `token`. */
  public withRemoved(from: EntityArchetype<CT>, token: CT): ArchetypeEdge<CT> {
    const edge = from.removeEdges.get(token);
    if (edge !== undefined) return edge;
    if (from.getColumn(token) === undefined) throw new Error("archetype lacks the component being removed");

    this.link(this.getOrCreate(from.componentTypes.filter(t => t !== token)), from, token);
    return from.removeEdges.get(token)!;
  }

  /**
   * Drop every archetype holding no entities (disabled ones count), except the
   * component-less archetype every new entity starts in. Edges into and out of a
   * pruned archetype go with it, so neither `getOrCreate` nor an edge can hand it
   * back; a later request builds a fresh one.
   */
  public prune(): number {
    let pruneCount = 0;
    for (const [key, arch] of this._byKey) {
      if (arch.entityCountUnfiltered !== 0 || arch.componentTypes.length === 0) continue;
      this._byKey.delete(key);
      this.unlink(arch);
      this.onPruneArchetype.invoke(arch);
      pruneCount++;
    }
    return pruneCount;
  }

  public values(): IterableIterator<EntityArchetype<CT>> {
    return this._byKey.values();
  }

  /** Cache `smaller --add token--> larger` and `larger --remove token--> smaller`. */
  private link(smaller: EntityArchetype<CT>, larger: EntityArchetype<CT>, token: CT) {
    smaller.addEdges.set(token, {target: larger, columnMap: buildColumnMap(smaller, larger)});
    larger.removeEdges.set(token, {target: smaller, columnMap: buildColumnMap(larger, smaller)});
  }

  private unlink(arch: EntityArchetype<CT>) {
    for (const [token, edge] of arch.addEdges) edge.target.removeEdges.delete(token);
    for (const [token, edge] of arch.removeEdges) edge.target.addEdges.delete(token);
    arch.addEdges.clear();
    arch.removeEdges.clear();
  }
}
