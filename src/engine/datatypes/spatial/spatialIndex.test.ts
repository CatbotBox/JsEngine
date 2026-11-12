import {describe, expect, test} from "../../testing/harness";
import {AABB} from "../aabb";
import {QueryHit, SpatialIndex} from "./spatialIndex";
import {LinearIndex} from "./linearIndex";
import {ObjectOctree} from "./objectOctree";

const UINT32_RANGE = 0x100000000;

function xorshift32Rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s ^= s << 13;
        s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5;
        s >>>= 0;
        return s / UINT32_RANGE;
    };
}

function box(x: number, y: number, size = 1): AABB {
    return AABB.of(x, y, 0, x + size, y + size, 1);
}

function sortedPayloadHits<P>(index: SpatialIndex<P>, range: AABB): P[] {
    const out: QueryHit<P>[] = [];
    const n = index.query(range, out);
    return out.slice(0, n).map(h => h.payload).sort((a, b) => (a as number) - (b as number));
}

const WORLD = AABB.of(-1e6, -1e6, -1e6, 1e6, 1e6, 1e6);
const HEAVILY_SUBDIVIDING = {capacity: 2, maxDepth: 6};
const BARE_ROOT_NODE_COUNT = 1;

const implementations: Array<[string, () => SpatialIndex<number>]> = [
    ["LinearIndex", () => new LinearIndex<number>()],
    ["ObjectOctree", () => new ObjectOctree<number>()],
    ["ObjectOctree(cap=2)", () => new ObjectOctree<number>(HEAVILY_SUBDIVIDING)],
];

for (const [name, make] of implementations) {
    describe(name, () => {
        test("insert then query returns everything once", () => {
            const ix = make();
            const bounds = Array.from({length: 50}, (_, i) => box(i * 2, 0));
            const payloads = Array.from({length: 50}, (_, i) => i);
            ix.insertBatch(1, bounds, payloads);

            expect(ix.count).toBe(50);
            expect(sortedPayloadHits(ix, WORLD)).toEqual(payloads);
        });

        test("replaceBatch twice does not duplicate", () => {
            const ix = make();
            const bounds = Array.from({length: 20}, (_, i) => box(i, 0));
            const payloads = Array.from({length: 20}, (_, i) => i);

            for (let frame = 0; frame < 240; frame++) {
                ix.replaceBatch(7, bounds, payloads);
                expect(ix.count).toBe(20);
            }
            expect(sortedPayloadHits(ix, WORLD)).toEqual(payloads);
        });

        test("insertBatch is additive, unlike replaceBatch", () => {
            const ix = make();
            ix.insertBatch(1, [box(0, 0)], [10]);
            ix.insertBatch(1, [box(1, 0)], [11]);
            expect(ix.count).toBe(2);

            ix.replaceBatch(1, [box(2, 0)], [12]);
            expect(ix.count).toBe(1);
            expect(sortedPayloadHits(ix, WORLD)).toEqual([12]);
        });

        test("removeBatch removes exactly its own batch", () => {
            const ix = make();
            ix.insertBatch(1, Array.from({length: 30}, (_, i) => box(i, 0)), Array.from({length: 30}, (_, i) => i));
            ix.insertBatch(2, Array.from({length: 30}, (_, i) => box(i, 10)), Array.from({length: 30}, (_, i) => 100 + i));
            expect(ix.count).toBe(60);

            ix.removeBatch(1);
            expect(ix.count).toBe(30);
            expect(sortedPayloadHits(ix, WORLD)).toEqual(Array.from({length: 30}, (_, i) => 100 + i));

            ix.removeBatch(2);
            expect(ix.count).toBe(0);
            expect(sortedPayloadHits(ix, WORLD)).toEqual([]);
        });

        test("removing an unknown batch is a no-op", () => {
            const ix = make();
            ix.insertBatch(1, [box(0, 0)], [1]);
            ix.removeBatch(999);
            expect(ix.count).toBe(1);
        });

        test("churn one batch at a time leaves no residue", () => {
            const ix = make();
            for (let round = 0; round < 50; round++) {
                for (let b = 0; b < 10; b++) {
                    ix.replaceBatch(b, [box(b * 3, round % 5)], [b]);
                }
            }
            expect(ix.count).toBe(10);

            for (let b = 0; b < 10; b++) ix.removeBatch(b);
            expect(ix.count).toBe(0);
            expect(sortedPayloadHits(ix, WORLD)).toEqual([]);
        });

        test("query matches a brute-force scan across selectivities", () => {
            const rand = xorshift32Rng(0xC0FFEE);
            const ix = make();
            const n = 400;
            const bounds: AABB[] = [];
            const payloads: number[] = [];
            for (let i = 0; i < n; i++) {
                const x = (rand() - 0.5) * 200;
                const y = (rand() - 0.5) * 200;
                bounds.push(box(x, y, 1 + rand() * 4));
                payloads.push(i);
            }
            ix.insertBatch(1, bounds, payloads);

            for (const half of [2, 20, 100]) {
                const range = AABB.of(-half, -half, -1, half, half, 2);
                const expected = payloads.filter(i => AABB.intersects(bounds[i], range)).sort((a, b) => a - b);
                expect(sortedPayloadHits(ix, range)).toEqual(expected);
            }
        });

        test("query is empty before anything is inserted", () => {
            expect(sortedPayloadHits(make(), WORLD)).toEqual([]);
        });

        test("clear empties the index and it stays usable", () => {
            const ix = make();
            ix.insertBatch(1, Array.from({length: 40}, (_, i) => box(i, 0)), Array.from({length: 40}, (_, i) => i));
            ix.clear();
            expect(ix.count).toBe(0);
            expect(sortedPayloadHits(ix, WORLD)).toEqual([]);

            ix.insertBatch(1, [box(0, 0)], [99]);
            expect(sortedPayloadHits(ix, WORLD)).toEqual([99]);
        });

        test("handles bounds far outside the initial extent", () => {
            const ix = make();
            ix.insertBatch(1, [box(0, 0)], [1]);
            ix.insertBatch(2, [box(50_000, -50_000)], [2]);
            expect(ix.count).toBe(2);
            expect(sortedPayloadHits(ix, WORLD)).toEqual([1, 2]);
            expect(sortedPayloadHits(ix, AABB.of(49_999, -50_001, -1, 50_002, -49_998, 2))).toEqual([2]);
        });

        test("reuses the caller's output buffer without allocating per hit", () => {
            const ix = make();
            ix.insertBatch(1, Array.from({length: 10}, (_, i) => box(i, 0)), Array.from({length: 10}, (_, i) => i));

            const out: QueryHit<number>[] = [];
            expect(ix.query(WORLD, out)).toBe(10);
            const firstRecord = out[0];
            expect(ix.query(WORLD, out)).toBe(10);
            expect(out[0]).toBe(firstRecord);
        });

        test("hit records carry the item's bounds", () => {
            const ix = make();
            ix.insertBatch(1, [AABB.of(1, 2, 3, 4, 5, 6)], [42]);
            const out: QueryHit<number>[] = [];
            expect(ix.query(WORLD, out)).toBe(1);
            expect([out[0].xMin, out[0].yMin, out[0].zMin]).toEqual([1, 2, 3]);
            expect([out[0].xMax, out[0].yMax, out[0].zMax]).toEqual([4, 5, 6]);
            expect(out[0].payload).toBe(42);
        });
    });
}

describe("implementations agree with each other", () => {
    test("identical results for the same random workload", () => {
        const rand = xorshift32Rng(0x5EED);
        const linear = new LinearIndex<number>();
        const octree = new ObjectOctree<number>();
        const tight = new ObjectOctree<number>({capacity: 2, maxDepth: 6, looseFactor: 1.0});

        for (let batch = 0; batch < 12; batch++) {
            const bounds: AABB[] = [];
            const payloads: number[] = [];
            for (let i = 0; i < 40; i++) {
                const x = (rand() - 0.5) * 300;
                const y = (rand() - 0.5) * 300;
                bounds.push(box(x, y, 1 + rand() * 6));
                payloads.push(batch * 100 + i);
            }
            for (const ix of [linear, octree, tight]) ix.replaceBatch(batch, bounds, payloads);
        }

        for (const b of [1, 4, 9]) for (const ix of [linear, octree, tight]) ix.removeBatch(b);

        expect(octree.count).toBe(linear.count);
        expect(tight.count).toBe(linear.count);

        for (let t = 0; t < 25; t++) {
            const cx = (rand() - 0.5) * 300, cy = (rand() - 0.5) * 300;
            const half = 5 + rand() * 120;
            const range = AABB.of(cx - half, cy - half, -1, cx + half, cy + half, 2);
            const expected = sortedPayloadHits(linear, range);
            expect(sortedPayloadHits(octree, range)).toEqual(expected);
            expect(sortedPayloadHits(tight, range)).toEqual(expected);
        }
    });
});

describe("ObjectOctree structure", () => {
    test("empty subtrees collapse back to a leaf", () => {
        const octree = new ObjectOctree<number>(HEAVILY_SUBDIVIDING);
        const bounds = Array.from({length: 200}, (_, i) => box((i % 20) * 5, Math.floor(i / 20) * 5));
        const payloads = Array.from({length: 200}, (_, i) => i);

        octree.insertBatch(1, bounds, payloads);
        const subdivided = octree.nodeCount;
        expect(subdivided).toBeGreaterThan(BARE_ROOT_NODE_COUNT);

        octree.removeBatch(1);
        expect(octree.count).toBe(0);
        expect(octree.nodeCount).toBe(BARE_ROOT_NODE_COUNT);
    });

    test("repeated spawn/despawn does not grow the tree without bound", () => {
        const octree = new ObjectOctree<number>({capacity: 4, maxDepth: 6});
        const bounds = Array.from({length: 300}, (_, i) => box((i % 30) * 4, Math.floor(i / 30) * 4));
        const payloads = Array.from({length: 300}, (_, i) => i);

        octree.replaceBatch(1, bounds, payloads);
        const afterFirst = octree.nodeCount;

        for (let i = 0; i < 25; i++) octree.replaceBatch(1, bounds, payloads);

        expect(octree.count).toBe(300);
        expect(octree.nodeCount).toBe(afterFirst);
    });
});
