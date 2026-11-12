import {AABB} from "../aabb";
import {ItemStore} from "./itemStore";
import {ensureHit, QueryHit, SpatialIndex} from "./spatialIndex";

const DEFAULT_NODE_CAPACITY = 16;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_LOOSE_FACTOR = 1.1;
const MIN_LOOSE_FACTOR = 1;
const MIN_HALF_EXTENT = 0.5;
const OCTANT_COUNT = 8;

export interface OctreeOptions {
    capacity?: number;
    maxDepth?: number;
    looseFactor?: number;
}

class OctNode {
    x0 = 0;
    y0 = 0;
    z0 = 0;
    x1 = 0;
    y1 = 0;
    z1 = 0;
    depth = 0;
    parent: OctNode | null = null;
    children: OctNode[] | null = null;
    directItems: number[] = [];
    subtreeCount = 0;
}

export class ObjectOctree<P> implements SpatialIndex<P> {
    private store: ItemStore<P>;
    private root: OctNode | null = null;
    private readonly capacity: number;
    private readonly maxDepth: number;
    private readonly looseFactor: number;

    private nodesByBatch = new Map<number, Set<OctNode>>();

    constructor(opts: OctreeOptions = {}) {
        this.capacity = opts.capacity ?? DEFAULT_NODE_CAPACITY;
        this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
        this.looseFactor = Math.max(MIN_LOOSE_FACTOR, opts.looseFactor ?? DEFAULT_LOOSE_FACTOR);
        this.store = new ItemStore<P>();
    }

    get count(): number {
        return this.store.count;
    }

    get nodeCount(): number {
        return this.root === null ? 0 : this.countNodes(this.root);
    }

    replaceBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void {
        this.removeBatch(batchId);
        this.insertBatch(batchId, bounds, payloads);
    }

    insertBatch(batchId: number, bounds: readonly AABB[], payloads: readonly P[]): void {
        if (bounds.length === 0) return;

        const first = AABB.asFloat32Array(bounds[0]);
        let ux0 = first[0], uy0 = first[1], uz0 = first[2];
        let ux1 = first[3], uy1 = first[4], uz1 = first[5];
        for (let i = 1; i < bounds.length; i++) {
            const b = AABB.asFloat32Array(bounds[i]);
            if (b[0] < ux0) ux0 = b[0];
            if (b[1] < uy0) uy0 = b[1];
            if (b[2] < uz0) uz0 = b[2];
            if (b[3] > ux1) ux1 = b[3];
            if (b[4] > uy1) uy1 = b[4];
            if (b[5] > uz1) uz1 = b[5];
        }

        this.ensureRoot(ux0, uy0, uz0, ux1, uy1, uz1);
        this.growRootToFit(ux0, uy0, uz0, ux1, uy1, uz1);

        for (let i = 0; i < bounds.length; i++) {
            const slot = this.store.add(bounds[i], payloads[i], batchId);
            this.insertItem(this.root!, slot, batchId);
        }
    }

    removeBatch(batchId: number): void {
        const nodes = this.nodesByBatch.get(batchId);
        if (nodes === undefined) return;
        const batch = this.store.batch;

        for (const node of nodes) {
            const items = node.directItems;
            let w = 0, removed = 0;
            for (let r = 0; r < items.length; r++) {
                const slot = items[r];
                if (batch[slot] === batchId) {
                    this.store.release(slot);
                    removed++;
                } else {
                    items[w++] = slot;
                }
            }
            if (removed === 0) continue;
            items.length = w;
            this.decrementSubtreeAndCollapseEmpty(node, removed);
        }
        this.nodesByBatch.delete(batchId);
    }

    query(range: AABB, out: QueryHit<P>[]): number {
        if (this.root === null) return 0;
        const q = AABB.asFloat32Array(range);
        return this.queryNode(
            this.root, q[0], q[1], q[2], q[3], q[4], q[5], out, 0,
        );
    }

    clear(): void {
        this.store.clear();
        this.root = null;
        this.nodesByBatch.clear();
    }

    private queryNode(
        node: OctNode,
        qx0: number, qy0: number, qz0: number, qx1: number, qy1: number, qz1: number,
        out: QueryHit<P>[], found: number,
    ): number {
        if (node.subtreeCount === 0) return found;
        if (node.x1 < qx0 || node.x0 > qx1) return found;
        if (node.y1 < qy0 || node.y0 > qy1) return found;
        if (node.z1 < qz0 || node.z0 > qz1) return found;

        const {xMin, yMin, zMin, xMax, yMax, zMax, payload} = this.store;
        const items = node.directItems;
        for (let i = 0; i < items.length; i++) {
            const s = items[i];
            if (xMax[s] < qx0 || xMin[s] > qx1) continue;
            if (yMax[s] < qy0 || yMin[s] > qy1) continue;
            if (zMax[s] < qz0 || zMin[s] > qz1) continue;

            const hit = ensureHit(out, found++);
            hit.xMin = xMin[s];
            hit.yMin = yMin[s];
            hit.zMin = zMin[s];
            hit.xMax = xMax[s];
            hit.yMax = yMax[s];
            hit.zMax = zMax[s];
            hit.payload = payload[s] as P;
        }

        const children = node.children;
        if (children !== null) {
            for (let c = 0; c < OCTANT_COUNT; c++) {
                found = this.queryNode(children[c], qx0, qy0, qz0, qx1, qy1, qz1, out, found);
            }
        }
        return found;
    }

    private insertItem(node: OctNode, slot: number, batchId: number): void {
        const {xMin, yMin, zMin, xMax, yMax, zMax} = this.store;
        const bx0 = xMin[slot], by0 = yMin[slot], bz0 = zMin[slot];
        const bx1 = xMax[slot], by1 = yMax[slot], bz1 = zMax[slot];

        let current = node;
        current.subtreeCount++;

        for (; ;) {
            const children = current.children;
            if (children === null) break;
            let next: OctNode | null = null;
            for (let c = 0; c < OCTANT_COUNT; c++) {
                const ch = children[c];
                if (bx0 >= ch.x0 && bx1 <= ch.x1 && by0 >= ch.y0 && by1 <= ch.y1 && bz0 >= ch.z0 && bz1 <= ch.z1) {
                    next = ch;
                    break;
                }
            }
            if (next === null) break;
            current = next;
            current.subtreeCount++;
        }

        current.directItems.push(slot);
        this.trackBatch(current, batchId);

        if (current.children === null && current.directItems.length > this.capacity && current.depth < this.maxDepth) {
            this.subdivide(current);
        }
    }

    private subdivide(node: OctNode): void {
        const mx = (node.x0 + node.x1) * 0.5;
        const my = (node.y0 + node.y1) * 0.5;
        const mz = (node.z0 + node.z1) * 0.5;
        const lf = this.looseFactor;

        const makeChild = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): OctNode => {
            const n = new OctNode();
            const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5, cz = (z0 + z1) * 0.5;
            const hx = Math.max(MIN_HALF_EXTENT, (x1 - x0) * 0.5 * lf);
            const hy = Math.max(MIN_HALF_EXTENT, (y1 - y0) * 0.5 * lf);
            const hz = Math.max(MIN_HALF_EXTENT, (z1 - z0) * 0.5 * lf);
            n.x0 = cx - hx;
            n.y0 = cy - hy;
            n.z0 = cz - hz;
            n.x1 = cx + hx;
            n.y1 = cy + hy;
            n.z1 = cz + hz;
            n.depth = node.depth + 1;
            n.parent = node;
            return n;
        };

        node.children = [
            makeChild(node.x0, node.y0, node.z0, mx, my, mz),
            makeChild(mx, node.y0, node.z0, node.x1, my, mz),
            makeChild(node.x0, my, node.z0, mx, node.y1, mz),
            makeChild(mx, my, node.z0, node.x1, node.y1, mz),
            makeChild(node.x0, node.y0, mz, mx, my, node.z1),
            makeChild(mx, node.y0, mz, node.x1, my, node.z1),
            makeChild(node.x0, my, mz, mx, node.y1, node.z1),
            makeChild(mx, my, mz, node.x1, node.y1, node.z1),
        ];

        const {xMin, yMin, zMin, xMax, yMax, zMax, batch} = this.store;
        const items = node.directItems;
        let w = 0;
        for (let r = 0; r < items.length; r++) {
            const s = items[r];
            let moved = false;
            for (let c = 0; c < OCTANT_COUNT; c++) {
                const ch = node.children[c];
                if (xMin[s] >= ch.x0 && xMax[s] <= ch.x1 && yMin[s] >= ch.y0 && yMax[s] <= ch.y1
                    && zMin[s] >= ch.z0 && zMax[s] <= ch.z1) {
                    ch.directItems.push(s);
                    ch.subtreeCount++;
                    this.trackBatch(ch, batch[s]);
                    moved = true;
                    break;
                }
            }
            if (!moved) items[w++] = s;
        }
        if (w !== items.length) {
            items.length = w;
            this.retrackBatches(node);
        }
    }

    private decrementSubtreeAndCollapseEmpty(node: OctNode | null, removed: number): void {
        for (let n = node; n !== null; n = n.parent) {
            n.subtreeCount -= removed;
            if (n.subtreeCount === 0 && n.children !== null) {
                n.children = null;
            }
        }
    }

    private trackBatch(node: OctNode, batchId: number): void {
        let set = this.nodesByBatch.get(batchId);
        if (set === undefined) {
            set = new Set<OctNode>();
            this.nodesByBatch.set(batchId, set);
        }
        set.add(node);
    }

    private retrackBatches(node: OctNode): void {
        const batch = this.store.batch;
        for (let i = 0; i < node.directItems.length; i++) this.trackBatch(node, batch[node.directItems[i]]);
    }

    private ensureRoot(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
        if (this.root !== null) return;
        const n = new OctNode();
        const lf = this.looseFactor;
        const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5, cz = (z0 + z1) * 0.5;
        const hx = Math.max(MIN_HALF_EXTENT, (x1 - x0) * 0.5 * lf);
        const hy = Math.max(MIN_HALF_EXTENT, (y1 - y0) * 0.5 * lf);
        const hz = Math.max(MIN_HALF_EXTENT, (z1 - z0) * 0.5 * lf);
        n.x0 = cx - hx;
        n.y0 = cy - hy;
        n.z0 = cz - hz;
        n.x1 = cx + hx;
        n.y1 = cy + hy;
        n.z1 = cz + hz;
        this.root = n;
    }

    private growRootToFit(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
        const root = this.root!;
        if (x0 >= root.x0 && x1 <= root.x1 && y0 >= root.y0 && y1 <= root.y1 && z0 >= root.z0 && z1 <= root.z1) {
            return;
        }

        let rx0 = root.x0, ry0 = root.y0, rz0 = root.z0;
        let rx1 = root.x1, ry1 = root.y1, rz1 = root.z1;
        do {
            const sx = (rx1 - rx0) || 1, sy = (ry1 - ry0) || 1, sz = (rz1 - rz0) || 1;
            if (x0 < rx0) rx0 -= sx;
            if (x1 > rx1) rx1 += sx;
            if (y0 < ry0) ry0 -= sy;
            if (y1 > ry1) ry1 += sy;
            if (z0 < rz0) rz0 -= sz;
            if (z1 > rz1) rz1 += sz;
        } while (!(x0 >= rx0 && x1 <= rx1 && y0 >= ry0 && y1 <= ry1 && z0 >= rz0 && z1 <= rz1));

        const slots: number[] = [];
        this.collect(root, slots);

        const n = new OctNode();
        n.x0 = rx0;
        n.y0 = ry0;
        n.z0 = rz0;
        n.x1 = rx1;
        n.y1 = ry1;
        n.z1 = rz1;
        this.root = n;
        this.nodesByBatch.clear();

        const batch = this.store.batch;
        for (let i = 0; i < slots.length; i++) this.insertItem(n, slots[i], batch[slots[i]]);
    }

    private collect(node: OctNode, out: number[]): void {
        for (let i = 0; i < node.directItems.length; i++) out.push(node.directItems[i]);
        if (node.children !== null) for (let c = 0; c < OCTANT_COUNT; c++) this.collect(node.children[c], out);
    }

    private countNodes(node: OctNode): number {
        let n = 1;
        if (node.children !== null) for (let c = 0; c < OCTANT_COUNT; c++) n += this.countNodes(node.children[c]);
        return n;
    }
}
