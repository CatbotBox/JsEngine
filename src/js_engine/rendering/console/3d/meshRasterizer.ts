import {Mesh} from "../../3d/mesh";
import {ScreenBuffer} from "../consoleScreenBuffer";
import {rasterizeTriangleBand, TRI_STRIDE} from "./rasterKernel";
import {RasterWorkerPool} from "./rasterWorkerPool";

export interface MeshRasterizerConfig {
    /** Depth at which shading fades to black. */
    maxDepthFade: number;
    /** ANDed onto packed colors; dropping low bits lengthens ANSI color runs. */
    colorQuantMask: number;
    /** Worker threads to use (0 disables threading entirely). */
    workerCount: number;
    /** Dispatch to the pool only when a batch has at least this many triangles… */
    threadTriangleThreshold: number;
    /** …or its bounding boxes cover at least this many cells (whichever hits first). */
    threadAreaThreshold: number;
}

const NEAR_PLANE_Z = 0.1;

/**
 * Frame-scoped triangle pipeline for the console 3D pass:
 * model→view vertex transform, near-plane clipping, backface culling and
 * screen-space projection all run scalar over flat typed arrays (zero per-frame
 * allocation in steady state). Packed triangles are rasterized either on a
 * worker pool (disjoint row bands over shared memory) or synchronously, then
 * depth-composited into the ScreenBuffer.
 */
export class MeshRasterizer {
    private pool?: RasterWorkerPool;
    private poolBroken = false;

    // Triangle batch + raster layers; these alias the pool's shared buffers in
    // pooled mode, or locally grown arrays in synchronous mode.
    private triData: Float64Array<ArrayBufferLike> = new Float64Array(0);
    private depthLayer: Float32Array<ArrayBufferLike> = new Float32Array(0);
    private colorLayer: Int32Array<ArrayBufferLike> = new Int32Array(0);
    private localTriData = new Float64Array(4096 * TRI_STRIDE);
    private localDepthLayer = new Float32Array(0);
    private localColorLayer = new Int32Array(0);
    private usingPool = false;

    private viewVerts = new Float64Array(0);

    // Frame state
    private screenBuffer!: ScreenBuffer;
    private config!: MeshRasterizerConfig;
    private width = 0;
    private height = 0;
    private halfWidth = 0;
    private halfHeight = 0;
    private triCount = 0;
    private bboxAreaAccum = 0;
    private bandCount = 1;
    private rowsPerBand = 0;

    public beginFrame(screenBuffer: ScreenBuffer, width: number, height: number, config: MeshRasterizerConfig): void {
        this.screenBuffer = screenBuffer;
        this.config = config;
        this.width = width;
        this.height = height;
        this.halfWidth = width / 2;
        this.halfHeight = height / 2;
        this.triCount = 0;
        this.bboxAreaAccum = 0;

        const cellCount = width * height;
        const pool = this.ensurePool(config.workerCount);
        this.usingPool = pool !== undefined && cellCount <= RasterWorkerPool.MAX_CELLS;

        if (this.usingPool) {
            this.triData = pool!.triData;
            this.depthLayer = pool!.depthLayer;
            this.colorLayer = pool!.colorLayer;
            this.bandCount = pool!.workerCount + 1;
            this.rowsPerBand = height > 0 ? Math.ceil(height / this.bandCount) : 1;
            pool!.bandCounts.fill(0);
        } else {
            this.bandCount = 1;
            if (this.localDepthLayer.length < cellCount) {
                this.localDepthLayer = new Float32Array(cellCount);
                this.localColorLayer = new Int32Array(cellCount);
            }
            this.triData = this.localTriData;
            this.depthLayer = this.localDepthLayer;
            this.colorLayer = this.localColorLayer;
        }
        this.depthLayer.fill(Number.POSITIVE_INFINITY, 0, cellCount);
    }

    private ensurePool(workerCount: number): RasterWorkerPool | undefined {
        if (workerCount <= 0 || this.poolBroken) return undefined;
        if (this.pool === undefined) {
            try {
                this.pool = new RasterWorkerPool(workerCount);
            } catch {
                // No SharedArrayBuffer / worker support here — stay synchronous.
                this.poolBroken = true;
                return undefined;
            }
        }
        if (!this.pool.usable) {
            this.poolBroken = true;
            return undefined;
        }
        return this.pool;
    }

    /**
     * Transform, clip, cull, project and enqueue every triangle of a mesh.
     *
     * @param modelView   combined inverse-camera × local-to-world matrix (column-major 4x4)
     * @param focalLength screenHeight / (2 * tan(fov / 2)); undefined renders without perspective
     * @param cellRatio   horizontal cell aspect correction factor
     * @param baseColor   packed 0xRRGGBB shaded by depth fade
     */
    public addMesh(mesh: Mesh, modelView: Float32Array, focalLength: number | undefined, cellRatio: number, baseColor: number): void {
        if (this.width === 0 || this.height === 0) return;

        const vertCount = mesh.vertCount;
        if (this.viewVerts.length < vertCount * 3) {
            this.viewVerts = new Float64Array(vertCount * 3);
        }
        const view = this.viewVerts;
        const src = mesh.vertices.raw;

        const m0 = modelView[0], m4 = modelView[4], m8 = modelView[8], m12 = modelView[12];
        const m1 = modelView[1], m5 = modelView[5], m9 = modelView[9], m13 = modelView[13];
        const m2 = modelView[2], m6 = modelView[6], m10 = modelView[10], m14 = modelView[14];

        for (let i = 0, j = 0; i < vertCount; i++, j += 3) {
            const x = src[j], y = src[j + 1], z = src[j + 2];
            view[j] = m0 * x + m4 * y + m8 * z + m12;
            view[j + 1] = m1 * x + m5 * y + m9 * z + m13;
            view[j + 2] = m2 * x + m6 * y + m10 * z + m14;
        }

        const indices = mesh.triangles.raw;
        const triangleCount = mesh.triangleCount;

        for (let t = 0, k = 0; t < triangleCount; t++, k += 3) {
            const ia = (indices[k] | 0) * 3;
            const ib = (indices[k + 1] | 0) * 3;
            const ic = (indices[k + 2] | 0) * 3;

            const ax = view[ia], ay = view[ia + 1], az = view[ia + 2];
            const bx = view[ib], by = view[ib + 1], bz = view[ib + 2];
            const cx = view[ic], cy = view[ic + 1], cz = view[ic + 2];

            const aIn = az >= NEAR_PLANE_Z;
            const bIn = bz >= NEAR_PLANE_Z;
            const cIn = cz >= NEAR_PLANE_Z;

            if (aIn && bIn && cIn) {
                this.emitTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, focalLength, cellRatio, baseColor);
                continue;
            }
            if (!aIn && !bIn && !cIn) continue;

            // Near-plane clipping. Vertex order below mirrors the pre-rewrite
            // implementation (inside vertices in index order, then intersection
            // points), so winding — and thus backface culling — is unchanged.
            let in0x = 0, in0y = 0, in0z = 0, in1x = 0, in1y = 0, in1z = 0;
            let out0x = 0, out0y = 0, out0z = 0, out1x = 0, out1y = 0, out1z = 0;
            let insideCount = 0, outsideCount = 0;

            if (aIn) { in0x = ax; in0y = ay; in0z = az; insideCount = 1; }
            else { out0x = ax; out0y = ay; out0z = az; outsideCount = 1; }

            if (bIn) {
                if (insideCount === 0) { in0x = bx; in0y = by; in0z = bz; }
                else { in1x = bx; in1y = by; in1z = bz; }
                insideCount++;
            } else {
                if (outsideCount === 0) { out0x = bx; out0y = by; out0z = bz; }
                else { out1x = bx; out1y = by; out1z = bz; }
                outsideCount++;
            }

            if (cIn) {
                if (insideCount === 0) { in0x = cx; in0y = cy; in0z = cz; }
                else { in1x = cx; in1y = cy; in1z = cz; }
                insideCount++;
            } else {
                if (outsideCount === 0) { out0x = cx; out0y = cy; out0z = cz; }
                else { out1x = cx; out1y = cy; out1z = cz; }
            }

            if (insideCount === 1) {
                // Clipped to a single smaller triangle.
                let t1 = (NEAR_PLANE_Z - in0z) / (out0z - in0z);
                const i1x = in0x + t1 * (out0x - in0x);
                const i1y = in0y + t1 * (out0y - in0y);
                let t2 = (NEAR_PLANE_Z - in0z) / (out1z - in0z);
                const i2x = in0x + t2 * (out1x - in0x);
                const i2y = in0y + t2 * (out1y - in0y);
                this.emitTriangle(in0x, in0y, in0z, i1x, i1y, NEAR_PLANE_Z, i2x, i2y, NEAR_PLANE_Z, focalLength, cellRatio, baseColor);
            } else {
                // Clipped to a quad → two triangles.
                let t1 = (NEAR_PLANE_Z - in0z) / (out0z - in0z);
                const i1x = in0x + t1 * (out0x - in0x);
                const i1y = in0y + t1 * (out0y - in0y);
                let t2 = (NEAR_PLANE_Z - in1z) / (out0z - in1z);
                const i2x = in1x + t2 * (out0x - in1x);
                const i2y = in1y + t2 * (out0y - in1y);
                this.emitTriangle(in0x, in0y, in0z, in1x, in1y, in1z, i1x, i1y, NEAR_PLANE_Z, focalLength, cellRatio, baseColor);
                this.emitTriangle(in1x, in1y, in1z, i2x, i2y, NEAR_PLANE_Z, i1x, i1y, NEAR_PLANE_Z, focalLength, cellRatio, baseColor);
            }
        }
    }

    private emitTriangle(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        focalLength: number | undefined, cellRatio: number, baseColor: number,
    ): void {
        let sax: number, say: number, sbx: number, sby: number, scx: number, scy: number;
        if (focalLength !== undefined) {
            const ppuA = focalLength / az, ppuB = focalLength / bz, ppuC = focalLength / cz;
            sax = this.halfWidth + ax * ppuA * cellRatio;
            say = this.halfHeight + ay * ppuA;
            sbx = this.halfWidth + bx * ppuB * cellRatio;
            sby = this.halfHeight + by * ppuB;
            scx = this.halfWidth + cx * ppuC * cellRatio;
            scy = this.halfHeight + cy * ppuC;
        } else {
            sax = this.halfWidth + ax * cellRatio;
            say = this.halfHeight + ay;
            sbx = this.halfWidth + bx * cellRatio;
            sby = this.halfHeight + by;
            scx = this.halfWidth + cx * cellRatio;
            scy = this.halfHeight + cy;
        }

        // Backface / degenerate cull: only one winding can ever pass the
        // kernel's inside test, so skip the rest before they cost anything.
        const area2 = (sbx - sax) * (scy - say) - (sby - say) * (scx - sax);
        if (area2 >= 0) return;

        // Off-screen cull + workload estimate for the threading heuristic.
        let minX = sax < sbx ? sax : sbx; if (scx < minX) minX = scx;
        let maxX = sax > sbx ? sax : sbx; if (scx > maxX) maxX = scx;
        let minY = say < sby ? say : sby; if (scy < minY) minY = scy;
        let maxY = say > sby ? say : sby; if (scy > maxY) maxY = scy;
        if (maxX <= 0 || minX >= this.width || maxY <= 0 || minY >= this.height) return;

        const clampedMinY = minY > 0 ? minY : 0;
        const clampedMaxY = maxY < this.height ? maxY : this.height;
        const clampedWidth = (maxX < this.width ? maxX : this.width) - (minX > 0 ? minX : 0);
        this.bboxAreaAccum += clampedWidth * (clampedMaxY - clampedMinY);

        if (this.triCount * TRI_STRIDE >= this.triData.length) {
            if (this.usingPool) {
                // Shared batch is full — rasterize and merge what we have, then reuse it.
                this.flushBatch(true);
            } else {
                const grown = new Float64Array(this.triData.length * 2);
                grown.set(this.triData);
                this.triData = grown;
                this.localTriData = grown;
            }
        }

        const o = this.triCount * TRI_STRIDE;
        const tris = this.triData;
        tris[o] = sax;
        tris[o + 1] = say;
        tris[o + 2] = sbx;
        tris[o + 3] = sby;
        tris[o + 4] = scx;
        tris[o + 5] = scy;
        tris[o + 6] = 1 / az;
        tris[o + 7] = 1 / bz;
        tris[o + 8] = 1 / cz;
        tris[o + 9] = baseColor;

        // Band binning: record which row bands this triangle overlaps so each
        // rasterizing thread only visits its own triangles.
        if (this.usingPool) {
            const pool = this.pool!;
            // The kernel visits pixel rows [floor(minY), ceil(maxY)) — mirror that here.
            const firstBand = (clampedMinY / this.rowsPerBand) | 0;
            const lastBand = ((Math.ceil(clampedMaxY) - 1) / this.rowsPerBand) | 0;
            for (let band = firstBand; band <= lastBand; band++) {
                pool.bandIndexes[band * RasterWorkerPool.MAX_TRIS + pool.bandCounts[band]] = this.triCount;
                pool.bandCounts[band]++;
            }
        }
        this.triCount++;
    }

    private flushBatch(prepareForMore: boolean): void {
        if (this.triCount === 0) return;
        const {width, height, config} = this;
        const quantMask = config.colorQuantMask & 0xFFFFFF;

        const pool = this.usingPool ? this.pool : undefined;
        const threaded = pool !== undefined
            && (this.triCount >= config.threadTriangleThreshold || this.bboxAreaAccum >= config.threadAreaThreshold);

        if (threaded) {
            if (!pool!.dispatch(this.triCount, width, height, config.maxDepthFade, quantMask)) {
                // Pool broke mid-frame; dispatch() already completed the layers
                // synchronously. Future frames go single-threaded.
                this.poolBroken = true;
            }
        } else {
            rasterizeTriangleBand(this.triData, this.triCount, null, 0, 0, this.depthLayer, this.colorLayer, width, 0, height, config.maxDepthFade, quantMask);
        }

        this.screenBuffer.mergeRgbLayer(this.depthLayer, this.colorLayer);
        this.triCount = 0;
        this.bboxAreaAccum = 0;
        if (prepareForMore) {
            this.depthLayer.fill(Number.POSITIVE_INFINITY, 0, width * height);
            if (this.usingPool) this.pool!.bandCounts.fill(0);
        }
    }

    /** Rasterize any queued triangles and composite them into the screen buffer. */
    public endFrame(): void {
        this.flushBatch(false);
    }

    public dispose(): void {
        this.pool?.dispose();
        this.pool = undefined;
    }
}
