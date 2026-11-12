import {TokenOrCtor, toTokens} from "../util/tokenUtils";
import {ComponentType} from "./componentType";
import {Event} from "../util/event";
import {ArchetypeEdge, EntityArchetype} from "./entityArchetype";

const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_32_PRIME = 0x01000193;
const INITIAL_SCRATCH_ID_CAPACITY = 16;

function hashTypeIds(ids: Int32Array, count: number): number {
  let h = FNV1A_32_OFFSET_BASIS | 0;
  for (let i = 0; i < count; i++) h = Math.imul(h ^ ids[i], FNV1A_32_PRIME);
  return h;
}

function sameTypeIds(key: Int32Array, ids: Int32Array, count: number): boolean {
  if (key.length !== count) return false;
  for (let i = 0; i < count; i++) if (key[i] !== ids[i]) return false;
  return true;
}

function buildColumnMap<CT extends ComponentType<any>>(source: EntityArchetype<CT>, target: EntityArchetype<CT>): Int32Array {
  const targetTypes = target.componentTypes;
  const map = new Int32Array(targetTypes.length);
  for (let i = 0; i < targetTypes.length; i++) map[i] = source.columnIndexOf(targetTypes[i]);
  return map;
}

export class EntityArchetypeMap<CT extends ComponentType<any> = ComponentType<any>> {
  private _archetypes: Set<EntityArchetype<CT>> = new Set();
  private _byTypeHash: Map<number, EntityArchetype<CT>[]> = new Map();
  private _scratchIds: Int32Array = new Int32Array(INITIAL_SCRATCH_ID_CAPACITY);

  public get loadedArchetypes(): number {
    return this._archetypes.size;
  }

  public onCreateArchetype: Event<EntityArchetype<CT>> = new Event();
  public onPruneArchetype: Event<EntityArchetype<CT>> = new Event();

  public getOrCreate(types: readonly TokenOrCtor[]): EntityArchetype<CT> {
    const count = this.writeSortedUniqueIdsToScratch(types);
    const ids = this._scratchIds;
    const hash = hashTypeIds(ids, count);
    const bucket = this._byTypeHash.get(hash);
    if (bucket !== undefined) {
      for (let i = 0; i < bucket.length; i++) {
        if (sameTypeIds(bucket[i].sortedTypeIds, ids, count)) return bucket[i];
      }
    }

    const archetype = new EntityArchetype<CT>(toTokens(types) as CT[]);
    if (bucket !== undefined) bucket.push(archetype);
    else this._byTypeHash.set(hash, [archetype]);
    this._archetypes.add(archetype);
    this.onCreateArchetype.invoke(archetype);
    return archetype;
  }

  private writeSortedUniqueIdsToScratch(types: readonly TokenOrCtor[]): number {
    if (this._scratchIds.length < types.length) this._scratchIds = new Int32Array(types.length * 2);
    const ids = this._scratchIds;
    let count = 0;
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const id = (typeof t === "function" ? ComponentType.of(t) : t).id;
      let at = count;
      while (at > 0 && ids[at - 1] > id) at--;
      if (at > 0 && ids[at - 1] === id) continue;
      for (let k = count; k > at; k--) ids[k] = ids[k - 1];
      ids[at] = id;
      count++;
    }
    return count;
  }

  public withAdded(from: EntityArchetype<CT>, token: CT): ArchetypeEdge<CT> {
    const edge = from.addEdges.get(token);
    if (edge !== undefined) return edge;
    if (from.getColumn(token) !== undefined) throw new Error("archetype already has the component being added");

    this.linkBothWays(from, this.getOrCreate([...from.componentTypes, token]), token);
    return from.addEdges.get(token)!;
  }

  public withRemoved(from: EntityArchetype<CT>, token: CT): ArchetypeEdge<CT> {
    const edge = from.removeEdges.get(token);
    if (edge !== undefined) return edge;
    if (from.getColumn(token) === undefined) throw new Error("archetype lacks the component being removed");

    this.linkBothWays(this.getOrCreate(from.componentTypes.filter(t => t !== token)), from, token);
    return from.removeEdges.get(token)!;
  }

  public prune(): number {
    let pruneCount = 0;
    for (const arch of this._archetypes) {
      const holdsAnyEntity = arch.entityCountUnfiltered !== 0;
      const isSpawnArchetype = arch.componentTypes.length === 0;
      if (holdsAnyEntity || isSpawnArchetype) continue;
      this._archetypes.delete(arch);
      this.forgetTypeKey(arch);
      this.unlink(arch);
      this.onPruneArchetype.invoke(arch);
      pruneCount++;
    }
    return pruneCount;
  }

  public values(): IterableIterator<EntityArchetype<CT>> {
    return this._archetypes.values();
  }

  private forgetTypeKey(arch: EntityArchetype<CT>) {
    const key = arch.sortedTypeIds;
    const hash = hashTypeIds(key, key.length);
    const bucket = this._byTypeHash.get(hash)!;
    if (bucket.length === 1) this._byTypeHash.delete(hash);
    else bucket.splice(bucket.indexOf(arch), 1);
  }

  private linkBothWays(smaller: EntityArchetype<CT>, larger: EntityArchetype<CT>, token: CT) {
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
