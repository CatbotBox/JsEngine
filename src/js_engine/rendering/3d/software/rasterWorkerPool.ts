import {rasterizeTriangleBand, TRI_STRIDE} from "./rasterKernel";
import {TextureStore} from "./textureStore";
import {WORKER_ENTRY_POINT} from "../../../platform";
import type {WorkerFactory, WorkerHandle} from "../../../platform";

/**
 * Fork-join rasterization pool built on platform workers + SharedArrayBuffer + Atomics.
 *
 * The screen is split into horizontal row bands; band 0 is rasterized on the main
 * thread while each worker owns one of the remaining bands. Bands are disjoint, so
 * every thread writes to its own rows of the shared depth/color layers — no locks,
 * and the result is bit-identical to the single-threaded kernel.
 *
 * Workers run a dependency-free script (the kernel is inlined via
 * Function.toString()) that touches no host API: the platform's WorkerFactory
 * hands it its shared buffers, so it runs under node, tsx and bun without a
 * compiled worker entry file. All shared buffers are allocated once at maximum
 * size — no re-broadcasting on screen resize, which lets workers sit in a pure
 * Atomics.wait() loop with zero event-loop involvement per frame.
 *
 * If anything is unsupported (no SharedArrayBuffer, worker eval fails, a worker
 * dies or stalls), the pool marks itself broken and callers fall back to the
 * synchronous kernel — same output, just single-threaded.
 */

// Int32 control slots
const CTRL_JOB = 0;         // job generation counter (workers wait on this)
const CTRL_DONE = 1;        // completed-worker counter for the current job
const CTRL_WIDTH = 2;
const CTRL_HEIGHT = 3;
const CTRL_TRI_COUNT = 4;
const CTRL_BAND_COUNT = 5;
const CTRL_QUANT_MASK = 6;
const CTRL_EXIT = 7;
const CTRL_READY = 8;       // workers increment once booted; gates threaded dispatch
const CTRL_SLOTS = 9;

// Float64 control slots
const FCTRL_DEPTH_FADE = 0;
const FCTRL_SLOTS = 1;

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
    let lastJob = Atomics.load(ctrl, ${CTRL_JOB});
    Atomics.add(ctrl, ${CTRL_READY}, 1);
    for (;;) {
        Atomics.wait(ctrl, ${CTRL_JOB}, lastJob);
        const job = Atomics.load(ctrl, ${CTRL_JOB});
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
        Atomics.add(ctrl, ${CTRL_DONE}, 1);
        Atomics.notify(ctrl, ${CTRL_DONE});
    }
}
`;
}

export class RasterWorkerPool {
    /** Largest screen the shared layers can hold (cells). Bigger screens fall back to sync. */
    public static readonly MAX_CELLS = 2048 * 512;
    /** Triangle batch capacity; producers flush a batch when it fills up. */
    public static readonly MAX_TRIS = 1 << 17;
    /** Shared texel storage (all mip levels of all textures); textures past this render untextured. */
    public static readonly MAX_TEXELS = 8 << 20;
    public static readonly MAX_TEXTURES = 256;
    /** How long the join busy-spins before falling back to sleeping (ms). */
    private static readonly JOIN_SPIN_MS = 20;
    /** How long a join may stall before the pool is declared broken (ms). */
    private static readonly JOIN_TIMEOUT_MS = 2000;

    public readonly triData: Float32Array;
    public readonly triInts: Int32Array;
    public readonly depthLayer: Float32Array;
    public readonly colorLayer: Int32Array;
    public readonly textureStore: TextureStore;
    /** Per-band triangle index bins, band b occupying [b * MAX_TRIS, ...). */
    public readonly bandIndexes: Int32Array;
    /** Entries used per band bin. Written by the producer, read by workers. */
    public readonly bandCounts: Int32Array;

    private readonly ctrl: Int32Array;
    private readonly fctrl: Float64Array;
    private readonly workers: WorkerHandle[] = [];
    private broken = false;

    public constructor(workerCount: number, workerFactory: WorkerFactory) {
        if (typeof SharedArrayBuffer === "undefined") {
            throw new Error("SharedArrayBuffer unavailable");
        }

        const ctrlSab = new SharedArrayBuffer(CTRL_SLOTS * 4);
        const fctrlSab = new SharedArrayBuffer(FCTRL_SLOTS * 8);
        const triSab = new SharedArrayBuffer(RasterWorkerPool.MAX_TRIS * TRI_STRIDE * 4);
        const depthSab = new SharedArrayBuffer(RasterWorkerPool.MAX_CELLS * 4);
        const colorSab = new SharedArrayBuffer(RasterWorkerPool.MAX_CELLS * 4);
        const bandIndexSab = new SharedArrayBuffer((workerCount + 1) * RasterWorkerPool.MAX_TRIS * 4);
        const bandCountSab = new SharedArrayBuffer((workerCount + 1) * 4);
        const texelSab = new SharedArrayBuffer(RasterWorkerPool.MAX_TEXELS * 4);
        const textureTableSab = new SharedArrayBuffer(RasterWorkerPool.MAX_TEXTURES * TextureStore.DESCRIPTOR_STRIDE * 4);

        this.ctrl = new Int32Array(ctrlSab);
        this.fctrl = new Float64Array(fctrlSab);
        this.triData = new Float32Array(triSab);
        this.triInts = new Int32Array(triSab);
        this.depthLayer = new Float32Array(depthSab);
        this.colorLayer = new Int32Array(colorSab);
        this.bandIndexes = new Int32Array(bandIndexSab);
        this.bandCounts = new Int32Array(bandCountSab);
        this.textureStore = new TextureStore(new Int32Array(texelSab), new Int32Array(textureTableSab), false);

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
            // Workers block in Atomics.wait; never keep the process alive for them.
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

    /**
     * Rasterize triCount triangles from triData into the shared layers using all
     * bands. Blocks (Atomics.wait) until every band is finished; the main thread
     * contributes band 0 while waiting. Returns false if the pool broke mid-job —
     * the layers are still left complete via a synchronous fallback.
     */
    public dispatch(triCount: number, width: number, height: number, maxDepthFade: number, quantMask: number): boolean {
        const ctrl = this.ctrl;
        const bandCount = this.workers.length + 1;

        // Workers still booting (thread spawn takes tens of ms on some
        // runtimes)? Don't fire a job nobody is listening for — just rasterize
        // this batch synchronously; threading kicks in once they're all up.
        if (Atomics.load(ctrl, CTRL_READY) < this.workers.length) {
            this.rasterizeSynchronously(triCount, width, 0, height, maxDepthFade, quantMask);
            return true;
        }

        ctrl[CTRL_WIDTH] = width;
        ctrl[CTRL_HEIGHT] = height;
        ctrl[CTRL_TRI_COUNT] = triCount;
        ctrl[CTRL_BAND_COUNT] = bandCount;
        ctrl[CTRL_QUANT_MASK] = quantMask;
        this.fctrl[FCTRL_DEPTH_FADE] = maxDepthFade;

        Atomics.store(ctrl, CTRL_DONE, 0);
        Atomics.add(ctrl, CTRL_JOB, 1);
        Atomics.notify(ctrl, CTRL_JOB);

        // Main thread rasterizes band 0 while the workers handle theirs.
        const rowsPerBand = Math.ceil(height / bandCount);
        const mainEnd = Math.min(height, rowsPerBand);
        if (mainEnd > 0) {
            const store = this.textureStore;
            rasterizeTriangleBand(this.triData, this.triInts, triCount, this.bandIndexes, 0, this.bandCounts[0], this.depthLayer, this.colorLayer, store.texels, store.table, width, 0, mainEnd, maxDepthFade, quantMask);
        }

        // Join. Band workloads are sub-millisecond while waking a sleeping
        // main thread from Atomics.wait costs ~1ms+ on some runtimes (bun), so
        // spin first and only fall back to sleeping when a worker is genuinely
        // late.
        const startedAt = performance.now();
        const spinDeadline = startedAt + RasterWorkerPool.JOIN_SPIN_MS;
        for (;;) {
            const done = Atomics.load(ctrl, CTRL_DONE);
            if (done >= this.workers.length) return true;
            const now = performance.now();
            if (now < spinDeadline) continue;
            Atomics.wait(ctrl, CTRL_DONE, done, 5);
            if (now - startedAt > RasterWorkerPool.JOIN_TIMEOUT_MS) {
                // A worker died or stalled. Finish the frame synchronously and
                // never dispatch to this pool again.
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
        Atomics.add(this.ctrl, CTRL_JOB, 1);
        Atomics.notify(this.ctrl, CTRL_JOB);
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers.length = 0;
    }
}
