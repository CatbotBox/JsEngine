/** Maps out where threaded rasterization beats sync: tri count × tri size grid. */
import {RasterWorkerPool} from "../src/js_engine/rendering/console/3d/rasterWorkerPool";
import {rasterizeTriangleBand, TRI_STRIDE} from "../src/js_engine/rendering/console/3d/rasterKernel";

const WIDTH = 480, HEIGHT = 128;
const pool = new RasterWorkerPool(3);

function fill(count: number, size: number): number {
    let area = 0;
    const bands = pool.workerCount + 1;
    const rowsPerBand = Math.ceil(HEIGHT / bands);
    pool.bandCounts.fill(0);
    for (let t = 0; t < count; t++) {
        const o = t * TRI_STRIDE;
        const x = (t * 37) % Math.max(1, WIDTH - size - 1);
        const y = (t * 17) % Math.max(1, HEIGHT - size - 1);
        pool.triData[o] = x; pool.triData[o + 1] = y;
        pool.triData[o + 2] = x + size; pool.triData[o + 3] = y + size;
        pool.triData[o + 4] = x + size; pool.triData[o + 5] = y;
        pool.triData[o + 6] = 0.2; pool.triData[o + 7] = 0.2; pool.triData[o + 8] = 0.2;
        pool.triData[o + 9] = 0xFFFFFF;
        area += size * size;
        const firstBand = (y / rowsPerBand) | 0;
        const lastBand = ((y + size) / rowsPerBand) | 0;
        for (let b = firstBand; b <= lastBand && b < bands; b++) {
            pool.bandIndexes[b * RasterWorkerPool.MAX_TRIS + pool.bandCounts[b]] = t;
            pool.bandCounts[b]++;
        }
    }
    return area;
}

function bench(fn: () => void, reps: number): number {
    fn(); // warm
    const t0 = performance.now();
    for (let i = 0; i < reps; i++) fn();
    return (performance.now() - t0) / reps;
}

setTimeout(() => {
    console.log("count  size | bboxArea  | sync ms | threaded ms | winner");
    for (const [count, size] of [[500, 2], [5000, 2], [40000, 2], [100, 16], [1000, 16], [10000, 16], [50, 64], [500, 64], [2000, 64], [12, 120], [100, 120]] as [number, number][]) {
        const area = fill(count, size);
        const syncMs = bench(() => {
            pool.depthLayer.fill(Number.POSITIVE_INFINITY, 0, WIDTH * HEIGHT);
            rasterizeTriangleBand(pool.triData, count, null, 0, 0, pool.depthLayer, pool.colorLayer, WIDTH, 0, HEIGHT, 15, 0xFFFFFF);
        }, 30);
        const threadedMs = bench(() => {
            pool.depthLayer.fill(Number.POSITIVE_INFINITY, 0, WIDTH * HEIGHT);
            pool.dispatch(count, WIDTH, HEIGHT, 15, 0xFFFFFF);
        }, 30);
        console.log(
            `${String(count).padStart(6)} ${String(size).padStart(4)} | ${String(area).padStart(9)} | ` +
            `${syncMs.toFixed(3).padStart(7)} | ${threadedMs.toFixed(3).padStart(11)} | ${threadedMs < syncMs ? "threaded" : "sync"}`
        );
    }
    pool.dispose();
}, 300);
