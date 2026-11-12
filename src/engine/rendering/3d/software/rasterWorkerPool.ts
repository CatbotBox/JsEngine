import {rasterizeTriangleBand, TRI_STRIDE} from "./rasterKernel";
import {TextureStore} from "./textureStore";
import {WORKER_ENTRY_POINT} from "../../../platform";
import type {WorkerFactory, WorkerHandle} from "../../../platform";

const CTRL_JOB_GENERATION = 0;
const CTRL_FINISHED_WORKERS = 1;
const CTRL_WIDTH = 2;
const CTRL_HEIGHT = 3;
const CTRL_TRI_COUNT = 4;
const CTRL_BAND_COUNT = 5;
const CTRL_QUANT_MASK = 6;
const CTRL_EXIT = 7;
const CTRL_BOOTED_WORKERS = 8;
const CTRL_SLOTS = 9;

const FCTRL_DEPTH_FADE = 0;
const FCTRL_SLOTS = 1;

const INT32_BYTES = Int32Array.BYTES_PER_ELEMENT;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const FIXED_SIZE = false;

function buildWorkerSource(): string {
    return `'use strict';
function ${WORKER_ENTRY_POINT}(workerData) {
    const raster = ${rasterizeTriangleBand.toString()};
    const ctrl = new Int32Array(workerData.ctrl);
    const fctrl = new Float64Array(workerData.fctrl);
    const trisF = new Float32Array(workerData.tris);
    const trisI = new Int32Array(workerData.tris);
    const depthLayer = new Float32Array(workerData.depth);
    const colorLayer = new Int32Array(workerData.color);
    const texels = new Int32Array(workerData.texels);
    const textureTable = new Int32Array(workerData.textureTable);
    const bandIndexes = new Int32Array(workerData.bandIndexes);
    const bandCounts = new Int32Array(workerData.bandCounts);
    const BAND_STRIDE = ${RasterWorkerPool.MAX_TRIS};
    const bandIndex = workerData.bandIndex; // 1-based; band 0 belongs to the main thread
    // Record the job generation BEFORE signalling readiness: jobs dispatched from
    // here on are guaranteed to be observed (Atomics.wait on a stale value returns
    // immediately), and the pool won't send jobs until every worker is ready.
    let lastJob = Atomics.load(ctrl, ${CTRL_JOB_GENERATION});
    Atomics.add(ctrl, ${CTRL_BOOTED_WORKERS}, 1);
    for (;;) {
        Atomics.wait(ctrl, ${CTRL_JOB_GENERATION}, lastJob);
        const job = Atomics.load(ctrl, ${CTRL_JOB_GENERATION});
        if (job === lastJob) continue;
        lastJob = job;
        if (Atomics.load(ctrl, ${CTRL_EXIT}) !== 0) break;
        const width = Atomics.load(ctrl, ${CTRL_WIDTH});
        const height = Atomics.load(ctrl, ${CTRL_HEIGHT});
        const triCount = Atomics.load(ctrl, ${CTRL_TRI_COUNT});
        const bandCount = Atomics.load(ctrl, ${CTRL_BAND_COUNT});
        const quantMask = Atomics.load(ctrl, ${CTRL_QUANT_MASK});
        const rowsPerBand = Math.ceil(height / bandCount);
        const yStart = Math.min(height, bandIndex * rowsPerBand);
        const yEnd = Math.min(height, yStart + rowsPerBand);
        if (yStart < yEnd && triCount > 0) {
            const myCount = Atomics.load(bandCounts, bandIndex);
            raster(trisF, trisI, triCount, bandIndexes, bandIndex * BAND_STRIDE, myCount, depthLayer, colorLayer, texels, textureTable, width, yStart, yEnd, fctrl[${FCTRL_DEPTH_FADE}], quantMask);
        }
        Atomics.add(ctrl, ${CTRL_FINISHED_WORKERS}, 1);
        Atomics.notify(ctrl, ${CTRL_FINISHED_WORKERS});
    }
}
`;
}

export class RasterWorkerPool {
    public static readonly MAX_CELLS = 2048 * 512;
    public static readonly MAX_TRIS = 1 << 17;
    public static readonly MAX_TEXELS = 8 << 20;
    public static readonly MAX_TEXTURES = 256;
    private static readonly JOIN_SPIN_MS = 20;
    private static readonly JOIN_SLEEP_MS = 5;
    private static readonly JOIN_TIMEOUT_MS = 2000;

    public readonly triData: Float32Array;
    public readonly triInts: Int32Array;
    public readonly depthLayer: Float32Array;
    public readonly colorLayer: Int32Array;
    public readonly textureStore: TextureStore;
    public readonly bandIndexes: Int32Array;
    public readonly bandCounts: Int32Array;

    private readonly ctrl: Int32Array;
    private readonly fctrl: Float64Array;
    private readonly workers: WorkerHandle[] = [];
    private broken = false;

    public constructor(workerCount: number, workerFactory: WorkerFactory) {
        if (typeof SharedArrayBuffer === "undefined") {
            throw new Error("SharedArrayBuffer unavailable");
        }

        const ctrlSab = new SharedArrayBuffer(CTRL_SLOTS * INT32_BYTES);
        const fctrlSab = new SharedArrayBuffer(FCTRL_SLOTS * FLOAT64_BYTES);
        const triSab = new SharedArrayBuffer(RasterWorkerPool.MAX_TRIS * TRI_STRIDE * FLOAT32_BYTES);
        const depthSab = new SharedArrayBuffer(RasterWorkerPool.MAX_CELLS * FLOAT32_BYTES);
        const colorSab = new SharedArrayBuffer(RasterWorkerPool.MAX_CELLS * INT32_BYTES);
        const bandIndexSab = new SharedArrayBuffer((workerCount + 1) * RasterWorkerPool.MAX_TRIS * INT32_BYTES);
        const bandCountSab = new SharedArrayBuffer((workerCount + 1) * INT32_BYTES);
        const texelSab = new SharedArrayBuffer(RasterWorkerPool.MAX_TEXELS * INT32_BYTES);
        const textureTableSab = new SharedArrayBuffer(RasterWorkerPool.MAX_TEXTURES * TextureStore.DESCRIPTOR_STRIDE * INT32_BYTES);

        this.ctrl = new Int32Array(ctrlSab);
        this.fctrl = new Float64Array(fctrlSab);
        this.triData = new Float32Array(triSab);
        this.triInts = new Int32Array(triSab);
        this.depthLayer = new Float32Array(depthSab);
        this.colorLayer = new Int32Array(colorSab);
        this.bandIndexes = new Int32Array(bandIndexSab);
        this.bandCounts = new Int32Array(bandCountSab);
        this.textureStore = new TextureStore(new Int32Array(texelSab), new Int32Array(textureTableSab), FIXED_SIZE);

        const source = buildWorkerSource();
        for (let i = 0; i < workerCount; i++) {
            const worker = workerFactory.spawn(source, {
                ctrl: ctrlSab,
                fctrl: fctrlSab,
                tris: triSab,
                depth: depthSab,
                color: colorSab,
                bandIndexes: bandIndexSab,
                bandCounts: bandCountSab,
                texels: texelSab,
                textureTable: textureTableSab,
                bandIndex: i + 1,
            });
            worker.onError(() => {
                this.broken = true;
            });
            worker.unref?.();
            this.workers.push(worker);
        }
    }

    public get workerCount(): number {
        return this.workers.length;
    }

    public get usable(): boolean {
        return !this.broken && this.workers.length > 0;
    }

    public get ready(): boolean {
        return Atomics.load(this.ctrl, CTRL_BOOTED_WORKERS) >= this.workers.length;
    }

    public stillUsableAfterDispatch(triCount: number, width: number, height: number, maxDepthFade: number, quantMask: number): boolean {
        const ctrl = this.ctrl;
        const bandCount = this.workers.length + 1;

        if (Atomics.load(ctrl, CTRL_BOOTED_WORKERS) < this.workers.length) {
            this.rasterizeSynchronously(triCount, width, 0, height, maxDepthFade, quantMask);
            return true;
        }

        ctrl[CTRL_WIDTH] = width;
        ctrl[CTRL_HEIGHT] = height;
        ctrl[CTRL_TRI_COUNT] = triCount;
        ctrl[CTRL_BAND_COUNT] = bandCount;
        ctrl[CTRL_QUANT_MASK] = quantMask;
        this.fctrl[FCTRL_DEPTH_FADE] = maxDepthFade;

        Atomics.store(ctrl, CTRL_FINISHED_WORKERS, 0);
        Atomics.add(ctrl, CTRL_JOB_GENERATION, 1);
        Atomics.notify(ctrl, CTRL_JOB_GENERATION);

        const rowsPerBand = Math.ceil(height / bandCount);
        const mainEnd = Math.min(height, rowsPerBand);
        if (mainEnd > 0) {
            const store = this.textureStore;
            rasterizeTriangleBand(this.triData, this.triInts, triCount, this.bandIndexes, 0, this.bandCounts[0], this.depthLayer, this.colorLayer, store.texels, store.table, width, 0, mainEnd, maxDepthFade, quantMask);
        }

        const startedAt = performance.now();
        const spinDeadline = startedAt + RasterWorkerPool.JOIN_SPIN_MS;
        for (;;) {
            const done = Atomics.load(ctrl, CTRL_FINISHED_WORKERS);
            if (done >= this.workers.length) return true;
            const now = performance.now();
            if (now < spinDeadline) continue;
            Atomics.wait(ctrl, CTRL_FINISHED_WORKERS, done, RasterWorkerPool.JOIN_SLEEP_MS);
            if (now - startedAt > RasterWorkerPool.JOIN_TIMEOUT_MS) {
                this.broken = true;
                if (height > mainEnd) {
                    this.rasterizeSynchronously(triCount, width, mainEnd, height, maxDepthFade, quantMask);
                }
                return false;
            }
        }
    }

    private rasterizeSynchronously(triCount: number, width: number, yStart: number, yEnd: number, maxDepthFade: number, quantMask: number): void {
        const store = this.textureStore;
        rasterizeTriangleBand(this.triData, this.triInts, triCount, null, 0, 0, this.depthLayer, this.colorLayer, store.texels, store.table, width, yStart, yEnd, maxDepthFade, quantMask);
    }

    public dispose(): void {
        this.broken = true;
        Atomics.store(this.ctrl, CTRL_EXIT, 1);
        Atomics.add(this.ctrl, CTRL_JOB_GENERATION, 1);
        Atomics.notify(this.ctrl, CTRL_JOB_GENERATION);
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers.length = 0;
    }
}
