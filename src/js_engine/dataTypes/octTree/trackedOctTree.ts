import {AABB} from "../AABB";
import {it} from "node:test";


export interface TrackedOctItem<T, U> {
    batchId: U;
    bounds: AABB;
    payload: T;
}

export interface TrackedOctreeOptions {
    capacity?: number;     // items per node before subdividing
    maxDepth?: number;     // node subdivision depth (not a world-size limit)
    looseFactor?: number;  // >= 1; adds slack to nodes to reduce churn
}

class OctNode<T, U> {
    bounds: AABB;
    depth: number;
    capacity: number;
    maxDepth: number;
    items: TrackedOctItem<T, U>[] = [];
    children: OctNode<T, U>[] | null = null;

    // batch accounting for this node (not descendants)
    batchCounts = new Map<U, number>();

    constructor(bounds: AABB, depth: number, capacity: number, maxDepth: number) {
        this.bounds = bounds;
        this.depth = depth;
        this.capacity = capacity;
        this.maxDepth = maxDepth;
    }
}


export class TrackedOctree<T, U> {

    private root: OctNode<T, U> | null = null; // starts empty; created on first insert
    private readonly capacity: number;
    private readonly maxDepth: number;   // controls node fanout, not world size
    private readonly looseFactor: number;
    private _count: number = 0;
    get count(): number {
        return this._count;
    }

    private set count(value: number) {
        this._count = value;
    }

    // batchId -> set of nodes that currently contain items from that batch
    private batchIndex = new Map<U, Set<OctNode<T, U>>>();

    constructor(opts: TrackedOctreeOptions = {}) {
        this.capacity = opts.capacity ?? 16;
        this.maxDepth = opts.maxDepth ?? 8;
        this.looseFactor = Math.max(1, opts.looseFactor ?? 1.1);
    }

    /** Remove everything. */
    clear() {
        this.root = null;
        this.batchIndex.clear();
        this.count = 0;
    }

    /** Insert a single item (auto-grows if needed). */
    insert(item: TrackedOctItem<T, U>) {
        this.ensureRootInitialized(item.bounds);
        this.ensureFits(item.bounds);
        this.insertInto(this.root!, item);
        this.count++;
    }

    /** Insert many items with the same batch (auto-grows once as needed). */
    insertBatch(batchId: U, items: Omit<TrackedOctItem<T, U>, "batchId">[]) {
        if (items.length === 0) return;

        // Initialize root from the first item if needed
        this.ensureRootInitialized(items[0].bounds);

        // Precompute a union of all incoming bounds to grow root once
        let u = items[0].bounds;
        for (let i = 1; i < items.length; i++) u = AABB.union(u, items[i].bounds);
        this.ensureFits(u);

        for (const it of items) {
            this.insertInto(this.root!, {...it, batchId});
        }

        this.count += items.length;
    }

    /** Remove every item belonging to a batch id. */
    removeBatch(batchId: U) {
        const nodes = this.batchIndex.get(batchId);
        if (!nodes || nodes.size === 0) return;

        const arr = Array.from(nodes);
        for (const node of arr) {
            if (!node.items.length) continue;
            let removed = 0;
            const keep: TrackedOctItem<T, U>[] = [];
            for (const it of node.items) {
                if (it.batchId === batchId) {
                    removed++;
                } else {
                    keep.push(it);
                }
            }
            if (removed > 0) {
                node.items = keep;
                this.bumpBatch(node, batchId, -removed);
                this.count -= removed;
            }
        }
    }

    /** Query overlapping items. */
    query(range: AABB): TrackedOctItem<T, U>[] {
        const out: TrackedOctItem<T, U>[] = [];
        if (!this.root) return out;
        this.queryNode(this.root, range, out);
        return out;
    }

    // ===== internals =====

    private ensureRootInitialized(b: AABB) {
        if (this.root) return;
        this.root = new OctNode<T, U>(AABB.inflate(b, this.looseFactor), 0, this.capacity, this.maxDepth);
    }

    /** Ensure the root AABB contains b; if not, expand and rebuild. */
    private ensureFits(b: AABB) {
        if (!this.root) return;
        if (AABB.contains(this.root.bounds, b)) return;
        this.growRootToFit(b);
    }

    private growRootToFit(b: AABB) {
        if (!this.root) return;

        // Collect all items to reinsert (linear in current size)
        const all: TrackedOctItem<T, U>[] = [];
        this.collectAll(this.root, all);

        // Expand root bounds by doubling outward along needed axes until b fits
        let rb = this.root.bounds;
        do {
            const sx = (rb.xMax - rb.xMin) || 1;
            const sy = (rb.yMax - rb.yMin) || 1;
            const sz = (rb.zMax - rb.zMin) || 1;

            const growMinX = b.xMin < rb.xMin;
            const growMaxX = b.xMax > rb.xMax;
            const growMinY = b.yMin < rb.yMin;
            const growMaxY = b.yMax > rb.yMax;
            const growMinZ = b.zMin < rb.zMin;
            const growMaxZ = b.zMax > rb.zMax;

            rb = {
                xMin: rb.xMin - (growMinX ? sx : 0),
                xMax: rb.xMax + (growMaxX ? sx : 0),
                yMin: rb.yMin - (growMinY ? sy : 0),
                yMax: rb.yMax + (growMaxY ? sy : 0),
                zMin: rb.zMin - (growMinZ ? sz : 0),
                zMax: rb.zMax + (growMaxZ ? sz : 0),
            };
        } while (!AABB.contains(rb, b));

        // Rebuild: new root with inflated bounds, reset batch index
        this.batchIndex.clear();
        this.root = new OctNode<T, U>(AABB.inflate(rb, this.looseFactor), 0, this.capacity, this.maxDepth);

        // Reinsert everything
        for (const it of all) this.insertInto(this.root, it);
    }

    private collectAll(node: OctNode<T, U>, out: TrackedOctItem<T, U>[]) {
        for (const it of node.items) out.push(it);
        if (node.children) for (const c of node.children) this.collectAll(c, out);
    }

    private queryNode(node: OctNode<T, U>, range: AABB, out: TrackedOctItem<T, U>[]) {
        if (!AABB.intersects(node.bounds, range)) return;
        for (const it of node.items) if (AABB.intersects(it.bounds, range)) out.push(it);
        if (node.children) for (const c of node.children) this.queryNode(c, range, out);
    }

    private insertInto(node: OctNode<T, U>, item: TrackedOctItem<T, U>): boolean {
        if (!AABB.intersects(node.bounds, item.bounds)) return false;

        if (node.children) {
            for (const c of node.children) {
                if (AABB.contains(c.bounds, item.bounds)) {
                    return this.insertInto(c, item);
                }
            }
        }

        // keep here
        node.items.push(item);
        this.bumpBatch(node, item.batchId, +1);

        // subdivide & redistribute if needed
        if (!node.children && node.items.length > node.capacity && node.depth < node.maxDepth) {
            this.subdivide(node);
            const remain: TrackedOctItem<T, U>[] = [];
            for (const it of node.items) {
                let moved = false;
                for (const c of node.children!) {
                    if (AABB.contains(c.bounds, it.bounds)) {
                        this.bumpBatch(node, it.batchId, -1);
                        c.items.push(it);
                        this.bumpBatch(c, it.batchId, +1);
                        moved = true;
                        break;
                    }
                }
                if (!moved) remain.push(it);
            }
            node.items = remain;
        }
        return true;
    }

    private subdivide(node: OctNode<T, U>) {
        const {xMin, yMin, zMin, xMax, yMax, zMax} = node.bounds;
        const midX = (xMin + xMax) * 0.5;
        const midY = (yMin + yMax) * 0.5;
        const midZ = (zMin + zMax) * 0.5;
        const mk = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB =>
            AABB.inflate({xMin: x0, yMin: y0, zMin: z0, xMax: x1, yMax: y1, zMax: z1}, this.looseFactor);

        node.children = [
            new OctNode<T, U>(mk(xMin, yMin, zMin, midX, midY, midZ), node.depth + 1, node.capacity, node.maxDepth), // LLL
            new OctNode<T, U>(mk(midX, yMin, zMin, xMax, midY, midZ), node.depth + 1, node.capacity, node.maxDepth), // HLL
            new OctNode<T, U>(mk(xMin, midY, zMin, midX, yMax, midZ), node.depth + 1, node.capacity, node.maxDepth), // LHL
            new OctNode<T, U>(mk(midX, midY, zMin, xMax, yMax, midZ), node.depth + 1, node.capacity, node.maxDepth), // HHL
            new OctNode<T, U>(mk(xMin, yMin, midZ, midX, midY, zMax), node.depth + 1, node.capacity, node.maxDepth), // LLH
            new OctNode<T, U>(mk(midX, yMin, midZ, xMax, midY, zMax), node.depth + 1, node.capacity, node.maxDepth), // HLH
            new OctNode<T, U>(mk(xMin, midY, midZ, midX, yMax, zMax), node.depth + 1, node.capacity, node.maxDepth), // LHH
            new OctNode<T, U>(mk(midX, midY, midZ, xMax, yMax, zMax), node.depth + 1, node.capacity, node.maxDepth), // HHH
        ];
    }

    /** Maintain per-node count + global node set for each batchId. */
    private bumpBatch(node: OctNode<T, U>, batchId: U, delta: number) {
        const prev = node.batchCounts.get(batchId) ?? 0;
        const next = prev + delta;
        if (next <= 0) {
            if (prev > 0) {
                node.batchCounts.delete(batchId);
                const set = this.batchIndex.get(batchId);
                if (set) {
                    set.delete(node);
                    if (set.size === 0) this.batchIndex.delete(batchId);
                }
            }
        } else {
            node.batchCounts.set(batchId, next);
            let set = this.batchIndex.get(batchId);
            if (!set) {
                set = new Set();
                this.batchIndex.set(batchId, set);
            }
            set.add(node);
        }
    }
}
