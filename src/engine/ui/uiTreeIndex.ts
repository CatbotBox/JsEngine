import {Resource} from "../core";
import type {Entity} from "../core";

export const NO_PARENT_INDEX = -1;
export const NOT_IN_TREE = -1;

const INITIAL_CAPACITY_NODES = 16;
const CAPACITY_GROWTH_FACTOR = 2;

export class UiTreeIndex extends Resource {
    private _count = 0;
    private _entities: Entity[] = [];
    private _parentIndex: Int32Array = new Int32Array(INITIAL_CAPACITY_NODES);
    private _depth: Int32Array = new Int32Array(INITIAL_CAPACITY_NODES);
    private _subtreeEnd: Int32Array = new Int32Array(INITIAL_CAPACITY_NODES);
    private readonly _roots: number[] = [];
    private readonly _rootScales: number[] = [];
    private _version = 0;
    private readonly _indexOfEntity = new Map<Entity, number>();

    public get count(): number {
        return this._count;
    }

    public get entities(): readonly Entity[] {
        return this._entities;
    }

    public get parentIndex(): Int32Array {
        return this._parentIndex;
    }

    public get depth(): Int32Array {
        return this._depth;
    }

    public get subtreeEnd(): Int32Array {
        return this._subtreeEnd;
    }

    public get rootScales(): readonly number[] {
        return this._rootScales;
    }

    public get version(): number {
        return this._version;
    }

    public get roots(): readonly number[] {
        return this._roots;
    }

    public indexOf(entity: Entity): number {
        return this._indexOfEntity.get(entity) ?? NOT_IN_TREE;
    }

    public clear(): void {
        this._count = 0;
        this._entities.length = 0;
        this._roots.length = 0;
        this._rootScales.length = 0;
        this._version++;
        this._indexOfEntity.clear();
    }

    public beginRoot(entity: Entity, scale: number): number {
        const index = this.append(entity, NO_PARENT_INDEX);
        this._roots.push(index);
        this._rootScales.push(scale);
        return index;
    }

    public append(entity: Entity, parentIndex: number): number {
        const index = this._count;
        this.ensureCapacity(index + 1);
        this._entities[index] = entity;
        this._parentIndex[index] = parentIndex;
        this._depth[index] = parentIndex === NO_PARENT_INDEX ? 0 : this._depth[parentIndex] + 1;
        this._subtreeEnd[index] = index + 1;
        this._indexOfEntity.set(entity, index);
        this._count = index + 1;
        return index;
    }

    public closeSubtrees(fromIndex: number): void {
        const parentIndex = this._parentIndex, subtreeEnd = this._subtreeEnd;
        for (let index = this._count - 1; index > fromIndex; index--) {
            const parent = parentIndex[index];
            if (parent !== NO_PARENT_INDEX && subtreeEnd[index] > subtreeEnd[parent]) subtreeEnd[parent] = subtreeEnd[index];
        }
    }

    private ensureCapacity(count: number): void {
        if (count <= this._parentIndex.length) return;
        let capacity = this._parentIndex.length;
        while (capacity < count) capacity *= CAPACITY_GROWTH_FACTOR;
        this._parentIndex = grown(this._parentIndex, capacity);
        this._depth = grown(this._depth, capacity);
        this._subtreeEnd = grown(this._subtreeEnd, capacity);
    }
}

function grown(values: Int32Array, capacity: number): Int32Array {
    const next = new Int32Array(capacity);
    next.set(values);
    return next;
}
