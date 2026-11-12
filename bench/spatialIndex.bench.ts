import {AABB} from "../src/engine/datatypes/aabb";
import {LinearIndex} from "../src/engine/datatypes/spatial/linearIndex";
import {ObjectOctree} from "../src/engine/datatypes/spatial/objectOctree";
import {QueryHit, SpatialIndex} from "../src/engine/datatypes/spatial/spatialIndex";

const NS = [25, 1_000, 10_000, 100_000];
const ARCHETYPE_BATCHES = 8;
const WARMUP = 2;
const REPS = 5;
const WORLD_SPAN = 1_000;
const BYTES_PER_MB = 1048576;
const US_PER_MS = 1000;
const UINT32_RANGE = 0x100000000;
const BLOCKING_GC = true;
const MIN_ITEM_SIZE = 1, ITEM_SIZE_JITTER = 3;
const SELECTIVITIES = [0.01, 0.25, 0.8];
const FRAME_SELECTIVITY = 0.25;
const CROSS_CHECK_N = 2_000, CROSS_CHECK_SEED = 0x1234;
const TIMED_ITERATIONS = 5;
const UNCACHED_QUERY_ITERATIONS = 3;
const MUTATION_HEAP_OPS = 20;
const QUERY_HEAP_OPS = 50;
const FRAME_HEAP_FRAMES = 100;
const TUNING_N = 10_000;
const MOTION_NS = [10_000, 100_000];
const MOTION_ITERATIONS = 10;
const CLUSTERS = 24, CLUSTER_SPREAD = 40;
const CLUSTER_HASH_X = 2654435761, CLUSTER_HASH_Y = 40503, CLUSTER_HASH_BUCKETS = 1000;
const CAM_W = 80, CAM_H = 24;
const PAN_RAD_PER_FRAME = 0.05;
const MOVING_ITEMS_N = 10_000;
const WOBBLE_RAD_PER_FRAME = 0.1, WOBBLE_AMPLITUDE = 5;
const SPAWN_FAR_BATCH = 1_000;
const SPAWN_FAR_START = 100, SPAWN_FAR_SPREAD = 100, SPAWN_FAR_ITEM_SIZE = 2;
const SPAWN_FAR_GROWTH = 1.5, SPAWN_FAR_RESET_AT = 1e7;

type Factory = { name: string; make: () => SpatialIndex<number> };

const factories: Factory[] = [
    {name: "LinearIndex", make: () => new LinearIndex<number>()},
    {name: "ObjectOctree", make: () => new ObjectOctree<number>()},
];

function rng(seed: number): () => number {
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

function makeWorkload(n: number, seed = 0xBEEF) {
    const rand = rng(seed);
    const perBatch = Math.max(1, Math.floor(n / ARCHETYPE_BATCHES));
    const bounds: AABB[][] = [];
    const payloads: number[][] = [];
    let id = 0;
    for (let b = 0; b < ARCHETYPE_BATCHES; b++) {
        const bb: AABB[] = [];
        const pp: number[] = [];
        for (let i = 0; i < perBatch; i++) {
            const x = (rand() - 0.5) * WORLD_SPAN;
            const y = (rand() - 0.5) * WORLD_SPAN;
            const s = MIN_ITEM_SIZE + rand() * ITEM_SIZE_JITTER;
            bb.push(AABB.of(x, y, 0, x + s, y + s, 1));
            pp.push(id++);
        }
        bounds.push(bb);
        payloads.push(pp);
    }
    return {bounds, payloads, total: id};
}

function rangeForSelectivity(fraction: number): AABB {
    const half = (WORLD_SPAN / 2) * Math.sqrt(fraction);
    return AABB.of(-half, -half, -1, half, half, 2);
}

function heapMb(): number {
    return process.memoryUsage().heapUsed / BYTES_PER_MB;
}

function forceGc(): void {
    (globalThis as any).Bun?.gc?.(BLOCKING_GC);
}

function bestMsPerCall(fn: () => void, iterations: number): number {
    for (let w = 0; w < WARMUP; w++) fn();
    const times: number[] = [];
    for (let r = 0; r < REPS; r++) {
        const t0 = performance.now();
        for (let i = 0; i < iterations; i++) fn();
        times.push((performance.now() - t0) / iterations);
    }
    return Math.min(...times);
}

function heapGrowthMb(fn: () => void, iterations: number): number {
    forceGc();
    const before = heapMb();
    for (let i = 0; i < iterations; i++) fn();
    return Math.max(0, heapMb() - before);
}

function row(cells: (string | number)[], widths: number[]): string {
    return cells.map((c, i) => String(c).padStart(widths[i])).join("  ");
}

function crossCheck(): void {
    const {bounds, payloads} = makeWorkload(CROSS_CHECK_N, CROSS_CHECK_SEED);
    const flatBounds = bounds.flat();
    const flatPayloads = payloads.flat();

    const built = factories.map(f => {
        const ix = f.make();
        for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.replaceBatch(b, bounds[b], payloads[b]);
        return {name: f.name, ix};
    });

    const out: QueryHit<number>[] = [];
    for (const fraction of SELECTIVITIES) {
        const range = rangeForSelectivity(fraction);
        const expected = flatPayloads.filter(i => AABB.intersects(flatBounds[i], range)).sort((a, b) => a - b);
        for (const {name, ix} of built) {
            const n = ix.query(range, out);
            const got = out.slice(0, n).map(h => h.payload).sort((a, b) => a - b);
            if (got.length !== expected.length || got.some((v, i) => v !== expected[i])) {
                throw new Error(`${name} disagrees with brute force at selectivity ${fraction}: ${got.length} vs ${expected.length}`);
            }
        }
    }
    console.log(`cross-check passed: all ${factories.length} implementations match brute force at 1% / 25% / 80%\n`);
}

function benchMutations(): void {
    console.log("A. Mutation cost — ms per operation, best of 5 (heap growth per 20 ops in MB)");
    console.log("-".repeat(96));
    const widths = [14, 9, 10, 10, 10, 10, 10, 10];
    console.log(row(["impl", "N", "create", "+heap", "update", "+heap", "remove", "+heap"], widths));

    for (const n of NS) {
        const {bounds, payloads} = makeWorkload(n);
        for (const f of factories) {
            const build = () => {
                const ix = f.make();
                for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            };
            const create = bestMsPerCall(build, 1);
            const createHeap = heapGrowthMb(build, TIMED_ITERATIONS);

            const ix = f.make();
            for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            const replaceFirstBatch = () => ix.replaceBatch(0, bounds[0], payloads[0]);
            const updateMs = bestMsPerCall(replaceFirstBatch, TIMED_ITERATIONS);
            const updateHeap = heapGrowthMb(replaceFirstBatch, MUTATION_HEAP_OPS);

            const removeThenReinsert = () => {
                ix.removeBatch(1);
                ix.insertBatch(1, bounds[1], payloads[1]);
            };
            const removeMs = bestMsPerCall(removeThenReinsert, TIMED_ITERATIONS);
            const removeHeap = heapGrowthMb(removeThenReinsert, MUTATION_HEAP_OPS);

            console.log(row([
                f.name, n,
                create.toFixed(2), createHeap.toFixed(1),
                updateMs.toFixed(3), updateHeap.toFixed(1),
                removeMs.toFixed(3), removeHeap.toFixed(1),
            ], widths));
        }
        console.log();
    }
}

function benchQueries(): void {
    console.log("B. Query cost — µs per query, best of 5");
    console.log("   uncached = immediately after a write   cached = repeated, no writes between");
    console.log("-".repeat(96));
    const widths = [14, 9, 7, 8, 12, 12, 10];
    console.log(row(["impl", "N", "sel", "hits", "uncached", "cached", "+heap"], widths));

    for (const n of NS) {
        const {bounds, payloads} = makeWorkload(n);
        for (const fraction of SELECTIVITIES) {
            const range = rangeForSelectivity(fraction);
            for (const f of factories) {
                const ix = f.make();
                for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
                const out: QueryHit<number>[] = [];
                const hits = ix.query(range, out);

                const uncached = bestMsPerCall(() => {
                    ix.replaceBatch(0, bounds[0], payloads[0]);
                    ix.query(range, out);
                }, UNCACHED_QUERY_ITERATIONS);
                const cached = bestMsPerCall(() => ix.query(range, out), TIMED_ITERATIONS);
                const growth = heapGrowthMb(() => ix.query(range, out), QUERY_HEAP_OPS);

                console.log(row([
                    f.name, n, `${(fraction * 100) | 0}%`, hits,
                    (uncached * US_PER_MS).toFixed(1), (cached * US_PER_MS).toFixed(1), growth.toFixed(1),
                ], widths));
            }
            console.log();
        }
    }
}

function benchFrame(): void {
    console.log("C. Per-frame cost — one changed batch + one camera query, µs per frame");
    console.log("-".repeat(96));
    const widths = [14, 9, 12, 12];
    console.log(row(["impl", "N", "frame", "+heap/100f"], widths));

    for (const n of NS) {
        const {bounds, payloads} = makeWorkload(n);
        const range = rangeForSelectivity(FRAME_SELECTIVITY);
        for (const f of factories) {
            const ix = f.make();
            for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            const out: QueryHit<number>[] = [];
            const frame = () => {
                ix.replaceBatch(0, bounds[0], payloads[0]);
                ix.query(range, out);
            };
            console.log(row([
                f.name, n,
                (bestMsPerCall(frame, TIMED_ITERATIONS) * US_PER_MS).toFixed(1),
                heapGrowthMb(frame, FRAME_HEAP_FRAMES).toFixed(1),
            ], widths));
        }
        console.log();
    }
}

function benchTuning(): void {
    console.log("D. Octree tuning at N=10k, 25% selectivity — µs per frame");
    console.log("-".repeat(96));
    const widths = [14, 10, 10, 12, 12];
    console.log(row(["impl", "capacity", "maxDepth", "loose", "frame"], widths));

    const {bounds, payloads} = makeWorkload(TUNING_N);
    const range = rangeForSelectivity(FRAME_SELECTIVITY);

    for (const capacity of [4, 16, 64]) {
        for (const maxDepth of [4, 8]) {
            for (const looseFactor of [1.0, 1.1]) {
                {
                    const name = "ObjectOctree";
                    const ix: SpatialIndex<number> = new ObjectOctree<number>({capacity, maxDepth, looseFactor});
                    for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
                    const out: QueryHit<number>[] = [];
                    const frame = () => {
                        ix.replaceBatch(0, bounds[0], payloads[0]);
                        ix.query(range, out);
                    };
                    console.log(row([name, capacity, maxDepth, looseFactor.toFixed(1), (bestMsPerCall(frame, TIMED_ITERATIONS) * US_PER_MS).toFixed(1)], widths));
                }
            }
        }
    }
    console.log();
}

function makeClustered(n: number, clusters: number, spread: number, seed = 0xC105) {
    const rand = rng(seed);
    const perBatch = Math.max(1, Math.floor(n / ARCHETYPE_BATCHES));
    const bounds: AABB[][] = [];
    const payloads: number[][] = [];
    let id = 0;
    for (let b = 0; b < ARCHETYPE_BATCHES; b++) {
        const bb: AABB[] = [];
        const pp: number[] = [];
        for (let i = 0; i < perBatch; i++) {
            const c = Math.floor(rand() * clusters);
            const cxc = ((c * CLUSTER_HASH_X) % CLUSTER_HASH_BUCKETS / CLUSTER_HASH_BUCKETS - 0.5) * WORLD_SPAN;
            const cyc = ((c * CLUSTER_HASH_Y) % CLUSTER_HASH_BUCKETS / CLUSTER_HASH_BUCKETS - 0.5) * WORLD_SPAN;
            const x = cxc + (rand() - 0.5) * spread;
            const y = cyc + (rand() - 0.5) * spread;
            const s = MIN_ITEM_SIZE + rand() * ITEM_SIZE_JITTER;
            bb.push(AABB.of(x, y, 0, x + s, y + s, 1));
            pp.push(id++);
        }
        bounds.push(bb);
        payloads.push(pp);
    }
    return {bounds, payloads};
}

function cameraAtFrame(t: number): AABB {
    const cx = Math.cos(t * PAN_RAD_PER_FRAME) * (WORLD_SPAN / 2);
    const cy = Math.sin(t * PAN_RAD_PER_FRAME) * (WORLD_SPAN / 2);
    return AABB.of(cx - CAM_W / 2, cy - CAM_H / 2, -1, cx + CAM_W / 2, cy + CAM_H / 2, 2);
}

function printPanningCameraRows(n: number, scenario: string, bounds: AABB[][], payloads: number[][], widths: number[]): void {
    for (const f of factories) {
        const ix = f.make();
        for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
        const out: QueryHit<number>[] = [];
        let t = 0, total = 0, frames = 0;
        const frame = () => {
            ix.replaceBatch(t % ARCHETYPE_BATCHES, bounds[t % ARCHETYPE_BATCHES], payloads[t % ARCHETYPE_BATCHES]);
            total += ix.query(cameraAtFrame(t), out);
            frames++;
            t++;
        };
        const ms = bestMsPerCall(frame, MOTION_ITERATIONS);
        console.log(row([f.name, n, scenario, (total / Math.max(1, frames)).toFixed(0), (ms * US_PER_MS).toFixed(1)], widths));
    }
    console.log();
}

function printMovingItemsRows(widths: number[]): void {
    const n = MOVING_ITEMS_N;
    const {bounds, payloads} = makeClustered(n, CLUSTERS, CLUSTER_SPREAD);
    for (const f of factories) {
        const ix = f.make();
        for (let b = 0; b < ARCHETYPE_BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
        const out: QueryHit<number>[] = [];
        let t = 0;
        const moved: AABB[] = bounds[0].map(() => AABB.alloc());
        const frame = () => {
            const src = bounds[0];
            const dx = Math.cos(t * WOBBLE_RAD_PER_FRAME) * WOBBLE_AMPLITUDE, dy = Math.sin(t * WOBBLE_RAD_PER_FRAME) * WOBBLE_AMPLITUDE;
            for (let i = 0; i < src.length; i++) {
                const s = AABB.asFloat32Array(src[i]);
                AABB.writeInto(moved[i], s[0] + dx, s[1] + dy, s[2], s[3] + dx, s[4] + dy, s[5]);
            }
            ix.replaceBatch(0, moved, payloads[0]);
            ix.query(cameraAtFrame(t), out);
            t++;
        };
        console.log(row([f.name, n, "items move", "-", (bestMsPerCall(frame, MOTION_ITERATIONS) * US_PER_MS).toFixed(1)], widths));
    }
    console.log();
}

function printSpawnFarRows(widths: number[]): void {
    for (const f of factories) {
        const ix = f.make();
        const out: QueryHit<number>[] = [];
        const rand = rng(0x5AFE);
        let far = SPAWN_FAR_START;
        const spawn = () => {
            const bb: AABB[] = [];
            const pp: number[] = [];
            for (let i = 0; i < SPAWN_FAR_BATCH; i++) {
                const x = far + (rand() - 0.5) * SPAWN_FAR_SPREAD;
                const y = far + (rand() - 0.5) * SPAWN_FAR_SPREAD;
                bb.push(AABB.of(x, y, 0, x + SPAWN_FAR_ITEM_SIZE, y + SPAWN_FAR_ITEM_SIZE, 1));
                pp.push(i);
            }
            ix.replaceBatch(0, bb, pp);
            ix.query(cameraAtFrame(far), out);
            far *= SPAWN_FAR_GROWTH;
            if (far > SPAWN_FAR_RESET_AT) far = SPAWN_FAR_START;
        };
        console.log(row([f.name, SPAWN_FAR_BATCH, "spawn-far", "-", (bestMsPerCall(spawn, TIMED_ITERATIONS) * US_PER_MS).toFixed(1)], widths));
    }
    console.log();
}

function benchMotion(): void {
    console.log("E. Motion — clustered items and a moving camera, µs per frame");
    console.log("   camera = an 80x24 screen-sized window panning across the world");
    console.log("-".repeat(96));
    const widths = [14, 9, 12, 10, 14];
    console.log(row(["impl", "N", "scenario", "hits/f", "frame"], widths));

    for (const n of MOTION_NS) {
        const clustered = makeClustered(n, CLUSTERS, CLUSTER_SPREAD);
        printPanningCameraRows(n, "clustered", clustered.bounds, clustered.payloads, widths);
        const uniform = makeWorkload(n);
        printPanningCameraRows(n, "uniform", uniform.bounds, uniform.payloads, widths);
    }

    console.log("   moving items — bounds change every frame, so nodes must be re-chosen");
    printMovingItemsRows(widths);

    console.log("   spawn-far — each batch lands further out, forcing root growth");
    printSpawnFarRows(widths);
}

crossCheck();
benchMutations();
benchQueries();
benchFrame();
benchTuning();
benchMotion();

console.log(`
Reading this:
  Section C is the one that decides — it is the operation mix the render pass
  actually performs. A and B break that down when C is close.

  None of these implementations memoise queries. The old TrackedOctree kept a
  single-entry cache keyed on version + range, which with one camera would hit
  every frame the camera stands still. If "cached" is not much faster than
  "uncached" here, that cache was doing real work and is worth adding back; if
  the query is already cheap, it was complexity for nothing.

  Heap growth is a lower bound (anything collected mid-run is invisible), but it
  separates "allocates per call" from "allocates nothing", which is the question
  the arena is here to answer. Expect ArenaOctree to win there rather than on time.
`);
