/**
 * bench/spatialIndex.bench.ts — run with `bun bench/spatialIndex.bench.ts`.
 *
 * Picks between LinearIndex and ObjectOctree for the 2D render
 * path. Structured around what the render pass actually does: a handful of
 * batches (one per archetype), replaceBatch on the ones that changed, and one
 * camera query per frame.
 *
 * WHY THE AXES ARE WHAT THEY ARE
 * - N sweeps to 100k because demo/tests/1.ts spawns 1,000 entities per keypress
 *   without bound. The engine's live demos are the stress test and the 3D test;
 *   pong/starCollectors are dead code and their ~25 entities are not the target.
 * - Selectivity matters because a camera query typically matches *most* on-screen
 *   items, which is the regime trees are worst at. A structure tuned for 1%
 *   selective queries can lose badly at 80%.
 * - Heap growth is reported next to time because the arena's expected win is
 *   allocation pressure, not throughput: an arena column read through a
 *   per-column view measures identical to a plain Float32Array (106.1 vs 106.0 µs
 *   per 100k). A time-only benchmark would show nothing and conclude wrongly.
 *
 * Results are cross-checked against a brute-force scan before timing, so a fast
 * wrong answer cannot win.
 */
import {AABB} from "../src/js_engine/datatypes/AABB";
import {LinearIndex} from "../src/js_engine/datatypes/spatial/linearIndex";
import {ObjectOctree} from "../src/js_engine/datatypes/spatial/objectOctree";
import {QueryHit, SpatialIndex} from "../src/js_engine/datatypes/spatial/spatialIndex";

const NS = [25, 1_000, 10_000, 100_000];
const BATCHES = 8;              // ~ one per archetype
const WARMUP = 2;
const REPS = 5;
const WORLD_SPAN = 1_000;

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
        return s / 0x100000000;
    };
}

/** Items split into BATCHES groups, mirroring one batch per archetype. */
function makeWorkload(n: number, seed = 0xBEEF) {
    const rand = rng(seed);
    const perBatch = Math.max(1, Math.floor(n / BATCHES));
    const bounds: AABB[][] = [];
    const payloads: number[][] = [];
    let id = 0;
    for (let b = 0; b < BATCHES; b++) {
        const bb: AABB[] = [];
        const pp: number[] = [];
        for (let i = 0; i < perBatch; i++) {
            const x = (rand() - 0.5) * WORLD_SPAN;
            const y = (rand() - 0.5) * WORLD_SPAN;
            const s = 1 + rand() * 3;
            bb.push(AABB.of(x, y, 0, x + s, y + s, 1));
            pp.push(id++);
        }
        bounds.push(bb);
        payloads.push(pp);
    }
    return {bounds, payloads, total: id};
}

/** A query box whose half-extent yields roughly `fraction` of items. */
function rangeForSelectivity(fraction: number): AABB {
    const half = (WORLD_SPAN / 2) * Math.sqrt(fraction);
    return AABB.of(-half, -half, -1, half, half, 2);
}

function heapMb(): number {
    return process.memoryUsage().heapUsed / 1048576;
}

function settle(): void {
    (globalThis as any).Bun?.gc?.(true);
}

/** Best-of-REPS wall time in ms for one call of `fn`, after warmup. */
function time(fn: () => void, iterations: number): number {
    for (let w = 0; w < WARMUP; w++) fn();
    const times: number[] = [];
    for (let r = 0; r < REPS; r++) {
        const t0 = performance.now();
        for (let i = 0; i < iterations; i++) fn();
        times.push((performance.now() - t0) / iterations);
    }
    return Math.min(...times);
}

/**
 * Heap growth over `iterations` calls, in MB. A lower bound on allocation volume
 * — anything the collector reclaims mid-run is invisible here — but it separates
 * "allocates per call" from "allocates nothing" clearly, which is the question.
 */
function heapGrowth(fn: () => void, iterations: number): number {
    settle();
    const before = heapMb();
    for (let i = 0; i < iterations; i++) fn();
    return Math.max(0, heapMb() - before);
}

function row(cells: (string | number)[], widths: number[]): string {
    return cells.map((c, i) => String(c).padStart(widths[i])).join("  ");
}

// ===========================================================================
// Correctness gate — nothing is timed until all three agree with brute force
// ===========================================================================

function crossCheck(): void {
    const {bounds, payloads} = makeWorkload(2_000, 0x1234);
    const flatBounds = bounds.flat();
    const flatPayloads = payloads.flat();

    const built = factories.map(f => {
        const ix = f.make();
        for (let b = 0; b < BATCHES; b++) ix.replaceBatch(b, bounds[b], payloads[b]);
        return {name: f.name, ix};
    });

    const out: QueryHit<number>[] = [];
    for (const fraction of [0.01, 0.25, 0.8]) {
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

// ===========================================================================
// A. Build, update, remove
// ===========================================================================

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
                for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            };
            const create = time(build, 1);
            const createHeap = heapGrowth(build, 5);

            // update: replaceBatch on one batch of an already-populated index
            const ix = f.make();
            for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            const update = () => ix.replaceBatch(0, bounds[0], payloads[0]);
            const updateMs = time(update, 5);
            const updateHeap = heapGrowth(update, 20);

            // remove: measured against a fresh insert each time, so it is not a no-op
            const removeCycle = () => {
                ix.removeBatch(1);
                ix.insertBatch(1, bounds[1], payloads[1]);
            };
            const removeMs = time(removeCycle, 5);
            const removeHeap = heapGrowth(removeCycle, 20);

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

// ===========================================================================
// B. Query — uncached (straight after a write) and cached (no write between)
// ===========================================================================

function benchQueries(): void {
    console.log("B. Query cost — µs per query, best of 5");
    console.log("   uncached = immediately after a write   cached = repeated, no writes between");
    console.log("-".repeat(96));
    const widths = [14, 9, 7, 8, 12, 12, 10];
    console.log(row(["impl", "N", "sel", "hits", "uncached", "cached", "+heap"], widths));

    for (const n of NS) {
        const {bounds, payloads} = makeWorkload(n);
        for (const fraction of [0.01, 0.25, 0.8]) {
            const range = rangeForSelectivity(fraction);
            for (const f of factories) {
                const ix = f.make();
                for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
                const out: QueryHit<number>[] = [];
                const hits = ix.query(range, out);

                const uncached = time(() => {
                    ix.replaceBatch(0, bounds[0], payloads[0]);  // invalidate
                    ix.query(range, out);
                }, 3);
                const cached = time(() => ix.query(range, out), 5);
                const growth = heapGrowth(() => ix.query(range, out), 50);

                console.log(row([
                    f.name, n, `${(fraction * 100) | 0}%`, hits,
                    (uncached * 1000).toFixed(1), (cached * 1000).toFixed(1), growth.toFixed(1),
                ], widths));
            }
            console.log();
        }
    }
}

// ===========================================================================
// C. Whole-frame cost — what the render pass actually pays
// ===========================================================================

function benchFrame(): void {
    console.log("C. Per-frame cost — one changed batch + one camera query, µs per frame");
    console.log("-".repeat(96));
    const widths = [14, 9, 12, 12];
    console.log(row(["impl", "N", "frame", "+heap/100f"], widths));

    for (const n of NS) {
        const {bounds, payloads} = makeWorkload(n);
        const range = rangeForSelectivity(0.25);
        for (const f of factories) {
            const ix = f.make();
            for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            const out: QueryHit<number>[] = [];
            const frame = () => {
                ix.replaceBatch(0, bounds[0], payloads[0]);
                ix.query(range, out);
            };
            console.log(row([
                f.name, n,
                (time(frame, 5) * 1000).toFixed(1),
                heapGrowth(frame, 100).toFixed(1),
            ], widths));
        }
        console.log();
    }
}

// ===========================================================================
// D. Tuning — do capacity/maxDepth/looseFactor matter more than the backend?
// ===========================================================================

function benchTuning(): void {
    console.log("D. Octree tuning at N=10k, 25% selectivity — µs per frame");
    console.log("-".repeat(96));
    const widths = [14, 10, 10, 12, 12];
    console.log(row(["impl", "capacity", "maxDepth", "loose", "frame"], widths));

    const {bounds, payloads} = makeWorkload(10_000);
    const range = rangeForSelectivity(0.25);

    for (const capacity of [4, 16, 64]) {
        for (const maxDepth of [4, 8]) {
            for (const looseFactor of [1.0, 1.1]) {
                {
                    const name = "ObjectOctree";
                    const ix: SpatialIndex<number> = new ObjectOctree<number>({capacity, maxDepth, looseFactor});
                    for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
                    const out: QueryHit<number>[] = [];
                    const frame = () => {
                        ix.replaceBatch(0, bounds[0], payloads[0]);
                        ix.query(range, out);
                    };
                    console.log(row([name, capacity, maxDepth, looseFactor.toFixed(1), (time(frame, 5) * 1000).toFixed(1)], widths));
                }
            }
        }
    }
    console.log();
}

// ===========================================================================
// E. Motion — the cases sections A-D deliberately do not cover
//
// A-D hold everything still: items uniformly spread over the world, the query
// box parked at the origin, and replaceBatch re-inserting identical bounds. That
// is the friendliest possible workload for a flat scan and the least friendly for
// a tree, because uniform density means there are no empty regions to prune.
//
// demo/tests/1.ts does none of that. It spawns 1,000 entities at a time around
// wherever the camera currently is, so items arrive in dense clumps separated by
// empty space, and the camera pans. This section reproduces that.
// ===========================================================================

/** Items in tight clumps rather than spread evenly — what spawning-at-camera makes. */
function makeClustered(n: number, clusters: number, spread: number, seed = 0xC105) {
    const rand = rng(seed);
    const perBatch = Math.max(1, Math.floor(n / BATCHES));
    const bounds: AABB[][] = [];
    const payloads: number[][] = [];
    let id = 0;
    for (let b = 0; b < BATCHES; b++) {
        const bb: AABB[] = [];
        const pp: number[] = [];
        for (let i = 0; i < perBatch; i++) {
            // pick a clump, then jitter inside it
            const c = Math.floor(rand() * clusters);
            const cxc = ((c * 2654435761) % 1000 / 1000 - 0.5) * WORLD_SPAN;
            const cyc = ((c * 40503) % 1000 / 1000 - 0.5) * WORLD_SPAN;
            const x = cxc + (rand() - 0.5) * spread;
            const y = cyc + (rand() - 0.5) * spread;
            const s = 1 + rand() * 3;
            bb.push(AABB.of(x, y, 0, x + s, y + s, 1));
            pp.push(id++);
        }
        bounds.push(bb);
        payloads.push(pp);
    }
    return {bounds, payloads};
}

function benchMotion(): void {
    console.log("E. Motion — clustered items and a moving camera, µs per frame");
    console.log("   camera = an 80x24 screen-sized window panning across the world");
    console.log("-".repeat(96));
    const widths = [14, 9, 12, 10, 14];
    console.log(row(["impl", "N", "scenario", "hits/f", "frame"], widths));

    const CAM_W = 80, CAM_H = 24;
    const camAt = (t: number): AABB => {
        const cx = Math.cos(t * 0.05) * (WORLD_SPAN / 2);
        const cy = Math.sin(t * 0.05) * (WORLD_SPAN / 2);
        return AABB.of(cx - CAM_W / 2, cy - CAM_H / 2, -1, cx + CAM_W / 2, cy + CAM_H / 2, 2);
    };

    for (const n of [10_000, 100_000]) {
        // (1) clustered items, camera panning — the tree's best case
        {
            const {bounds, payloads} = makeClustered(n, 24, 40);
            for (const f of factories) {
                const ix = f.make();
                for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
                const out: QueryHit<number>[] = [];
                let t = 0, total = 0, frames = 0;
                const frame = () => {
                    ix.replaceBatch(t % BATCHES, bounds[t % BATCHES], payloads[t % BATCHES]);
                    total += ix.query(camAt(t), out);
                    frames++;
                    t++;
                };
                const ms = time(frame, 10);
                console.log(row([f.name, n, "clustered", (total / Math.max(1, frames)).toFixed(0), (ms * 1000).toFixed(1)], widths));
            }
            console.log();
        }

        // (2) same camera, but items uniform — isolates clustering from motion
        {
            const {bounds, payloads} = makeWorkload(n);
            for (const f of factories) {
                const ix = f.make();
                for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
                const out: QueryHit<number>[] = [];
                let t = 0, total = 0, frames = 0;
                const frame = () => {
                    ix.replaceBatch(t % BATCHES, bounds[t % BATCHES], payloads[t % BATCHES]);
                    total += ix.query(camAt(t), out);
                    frames++;
                    t++;
                };
                const ms = time(frame, 10);
                console.log(row([f.name, n, "uniform", (total / Math.max(1, frames)).toFixed(0), (ms * 1000).toFixed(1)], widths));
            }
            console.log();
        }
    }

    // (3) items that actually MOVE, so the tree must re-place them each frame
    console.log("   moving items — bounds change every frame, so nodes must be re-chosen");
    {
        const n = 10_000;
        const {bounds, payloads} = makeClustered(n, 24, 40);
        for (const f of factories) {
            const ix = f.make();
            for (let b = 0; b < BATCHES; b++) ix.insertBatch(b, bounds[b], payloads[b]);
            const out: QueryHit<number>[] = [];
            let t = 0;
            const moved: AABB[] = bounds[0].map(() => AABB.alloc());
            const frame = () => {
                const src = bounds[0];
                const dx = Math.cos(t * 0.1) * 5, dy = Math.sin(t * 0.1) * 5;
                for (let i = 0; i < src.length; i++) {
                    const s = AABB.asFloat32Array(src[i]);
                    AABB.writeInto(moved[i], s[0] + dx, s[1] + dy, s[2], s[3] + dx, s[4] + dy, s[5]);
                }
                ix.replaceBatch(0, moved, payloads[0]);
                ix.query(camAt(t), out);
                t++;
            };
            console.log(row([f.name, n, "items move", "-", (time(frame, 10) * 1000).toFixed(1)], widths));
        }
        console.log();
    }

    // (4) spawning away from the origin, which forces the root to grow and rebuild
    console.log("   spawn-far — each batch lands further out, forcing root growth");
    {
        for (const f of factories) {
            const ix = f.make();
            const out: QueryHit<number>[] = [];
            const rand = rng(0x5AFE);
            let far = 100;
            const spawn = () => {
                const bb: AABB[] = [];
                const pp: number[] = [];
                for (let i = 0; i < 1_000; i++) {
                    const x = far + (rand() - 0.5) * 100;
                    const y = far + (rand() - 0.5) * 100;
                    bb.push(AABB.of(x, y, 0, x + 2, y + 2, 1));
                    pp.push(i);
                }
                ix.replaceBatch(0, bb, pp);
                ix.query(camAt(far), out);
                far *= 1.5;
                if (far > 1e7) far = 100;
            };
            console.log(row([f.name, 1_000, "spawn-far", "-", (time(spawn, 5) * 1000).toFixed(1)], widths));
        }
        console.log();
    }
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
