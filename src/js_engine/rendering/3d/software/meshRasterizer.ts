import {FaceCulling} from "../faceCulling";
import {DeepReadonly} from "../../../util/tokenUtils";
import {Mesh} from "../mesh";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import {multiplyPackedRgb} from "../material";
import {rasterizeTriangleBand, TRI_STRIDE} from "./rasterKernel";
import {RasterWorkerPool} from "./rasterWorkerPool";
import {TextureStore} from "./textureStore";
import {RasterTarget, SubsampleLayers} from "./rasterTarget";
import type {WorkerFactory} from "../../../platform";

export interface MeshRasterizerConfig {
    /** Depth at which shading fades to black. */
    maxDepthFade: number;
    /** ANDed onto packed colors; dropping low bits lengthens ANSI color runs. */
    colorQuantMask: number;
    /**
     * Antialiasing factor: each cell is rasterized as supersample×supersample
     * subsamples for the RasterTarget to resolve. 1 disables AA and reproduces
     * the single-sample pipeline exactly.
     */
    supersample: number;
    /** Per-axis overrides for supersample; terminal cells are ~2:1, so 2x4 gives square subsamples. */
    supersampleX?: number;
    supersampleY?: number;
    /**
     * Render two vertical samples per cell (top half first), doubling vertical
     * resolution. Each half still gets supersampleX × supersampleY subsamples.
     */
    halfBlock?: boolean;
    /** Worker threads to use (0 disables threading entirely). */
    workerCount: number;
    /** Dispatch to the pool only when a batch has at least this many triangles… */
    threadTriangleThreshold: number;
    /** …or its bounding boxes cover at least this many cells (whichever hits first). */
    threadAreaThreshold: number;
    /** Sample material textures; off renders every material by its diffuse color. */
    textures: boolean;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

export const NEAR_PLANE_Z = 0.1;
const LOG2 = Math.log(2);
const MAX_SUPERSAMPLE = 4;

function clampSupersample(value: number): number {
    return Math.max(1, Math.min(MAX_SUPERSAMPLE, Math.floor(value) || 1));
}

function packUnitRgb(r: number, g: number, b: number): number {
    return (clampToByte(r * 255) << 16) | (clampToByte(g * 255) << 8) | clampToByte(b * 255);
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

function lerpPackedColor(from: number, to: number, t: number): number {
    const r = ((from >> 16) & 255) + t * (((to >> 16) & 255) - ((from >> 16) & 255));
    const g = ((from >> 8) & 255) + t * (((to >> 8) & 255) - ((from >> 8) & 255));
    const b = (from & 255) + t * ((to & 255) - (from & 255));
    return (clampToByte(r) << 16) | (clampToByte(g) << 8) | clampToByte(b);
}

/**
 * Frame-scoped software triangle pipeline:
 * model→view vertex transform, near-plane clipping, backface culling and
 * screen-space projection all run scalar over flat typed arrays (zero per-frame
 * allocation in steady state). Packed triangles are rasterized either on a
 * worker pool (disjoint row bands over shared memory) or synchronously into
 * subsample layers, which are handed to a RasterTarget on every flush.
 */
export class MeshRasterizer {
    private pool?: RasterWorkerPool;
    private poolBroken = false;

    // Triangle batch + raster layers; these alias the pool's shared buffers in
    // pooled mode, or locally grown arrays in synchronous mode.
    private triData: Float32Array<ArrayBufferLike> = new Float32Array(0);
    private triInts: Int32Array<ArrayBufferLike> = new Int32Array(0);
    private depthLayer: Float32Array<ArrayBufferLike> = new Float32Array(0);
    private colorLayer: Int32Array<ArrayBufferLike> = new Int32Array(0);
    private textureStore: TextureStore = TextureStore.growable();
    private localTriData = new Float32Array(4096 * TRI_STRIDE);
    private localTriInts: Int32Array<ArrayBufferLike> = new Int32Array(this.localTriData.buffer);
    private localDepthLayer = new Float32Array(0);
    private localColorLayer = new Int32Array(0);
    private readonly localTextureStore = TextureStore.growable();
    private usingPool = false;

    private readonly layers: Writable<SubsampleLayers> = {
        depth: this.localDepthLayer,
        color: this.localColorLayer,
        width: 0,
        height: 0,
        supersampleX: 1,
        supersampleY: 1,
        rowsPerCell: 1,
        rasterWidth: 0,
        rasterHeight: 0,
        halfBlock: false,
    };

    private viewSpaceMesh = new ViewSpaceMesh();
    private vertexColors = new Int32Array(0);
    private materialColors = new Int32Array(0);
    private materialTextureIds = new Int32Array(0);
    private materialTexelAreas = new Float64Array(0);
    private materialLevelCounts = new Int32Array(0);

    // Frame state
    private target!: RasterTarget;
    private config!: MeshRasterizerConfig;
    private width = 0;
    private height = 0;
    private halfWidth = 0;
    private halfHeight = 0;
    // Supersampling: raster* dimensions are the subsample grid (cell dims x supersample factors)
    // that the kernel, layers and band binning all operate in.
    private supersampleX = 1;
    private rowsPerCell = 1;
    private subsamplesPerCell = 1;
    private rasterWidth = 0;
    private rasterHeight = 0;
    private triCount = 0;
    private bboxAreaAccum = 0;
    private bandCount = 1;
    private rowsPerBand = 0;
    private faceCulling = FaceCulling.BackFaces;

    /** Without `workers` the rasterizer is single-threaded whatever `workerCount` says. */
    public constructor(private readonly workers?: WorkerFactory) {
    }

    public beginFrame(target: RasterTarget, width: number, height: number, config: MeshRasterizerConfig): void {
        this.target = target;
        this.config = config;
        this.width = width;
        this.height = height;
        this.halfWidth = width / 2;
        this.halfHeight = height / 2;
        const sx = clampSupersample(config.supersampleX ?? config.supersample);
        const sy = clampSupersample(config.supersampleY ?? config.supersample);
        const halfBlock = config.halfBlock === true;
        this.supersampleX = sx;
        this.rowsPerCell = halfBlock ? sy * 2 : sy;
        this.subsamplesPerCell = sx * this.rowsPerCell;
        this.rasterWidth = width * sx;
        this.rasterHeight = height * this.rowsPerCell;
        this.triCount = 0;
        this.bboxAreaAccum = 0;

        const rasterCells = this.rasterWidth * this.rasterHeight;
        const pool = this.ensurePool(config.workerCount);
        this.usingPool = pool !== undefined && rasterCells <= RasterWorkerPool.MAX_CELLS;

        if (this.usingPool) {
            this.triData = pool!.triData;
            this.triInts = pool!.triInts;
            this.depthLayer = pool!.depthLayer;
            this.colorLayer = pool!.colorLayer;
            this.textureStore = pool!.textureStore;
            this.bandCount = pool!.workerCount + 1;
            this.rowsPerBand = this.rasterHeight > 0 ? Math.ceil(this.rasterHeight / this.bandCount) : 1;
            pool!.bandCounts.fill(0);
        } else {
            this.bandCount = 1;
            if (this.localDepthLayer.length < rasterCells) {
                this.localDepthLayer = new Float32Array(rasterCells);
                this.localColorLayer = new Int32Array(rasterCells);
            }
            this.triData = this.localTriData;
            this.triInts = this.localTriInts;
            this.depthLayer = this.localDepthLayer;
            this.colorLayer = this.localColorLayer;
            this.textureStore = this.localTextureStore;
        }
        const layers = this.layers;
        layers.depth = this.depthLayer;
        layers.color = this.colorLayer;
        layers.width = width;
        layers.height = height;
        layers.supersampleX = sx;
        layers.supersampleY = sy;
        layers.rowsPerCell = this.rowsPerCell;
        layers.rasterWidth = this.rasterWidth;
        layers.rasterHeight = this.rasterHeight;
        layers.halfBlock = halfBlock;
        this.depthLayer.fill(Number.POSITIVE_INFINITY, 0, rasterCells);
    }

    private ensurePool(workerCount: number): RasterWorkerPool | undefined {
        if (workerCount <= 0 || this.poolBroken || this.workers === undefined) return undefined;
        if (this.pool === undefined) {
            try {
                this.pool = new RasterWorkerPool(workerCount, this.workers);
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
     * @param baseColor   packed 0xRRGGBB tint multiplied onto every material color
     * @param vertexRgb   optional per-vertex linear color, 3 floats in 0..1 per vertex (replaces material color × tint)
     */
    public addMesh(mesh: DeepReadonly<Mesh>, modelView: Float32Array, focalLength: number | undefined, cellRatio: number, baseColor: number, vertexRgb: Float64Array | null = null, faceCulling: FaceCulling = FaceCulling.BackFaces): void {
        if (this.width === 0 || this.height === 0) return;
        this.addViewSpaceMesh(mesh, this.viewSpaceMesh.transformFrom(mesh, modelView, null), focalLength, cellRatio, baseColor, vertexRgb, faceCulling);
    }

    public addViewSpaceMesh(mesh: DeepReadonly<Mesh>, viewMesh: ViewSpaceMesh, focalLength: number | undefined, cellRatio: number, baseColor: number, vertexRgb: Float64Array | null, faceCulling: FaceCulling = FaceCulling.BackFaces): void {
        if (this.width === 0 || this.height === 0) return;
        this.faceCulling = faceCulling;

        const vertCount = viewMesh.vertCount;
        if (this.vertexColors.length < vertCount) this.vertexColors = new Int32Array(vertCount);
        const view = viewMesh.positions;
        const colors = this.vertexColors;
        this.fillVertexColors(colors, mesh, baseColor, vertexRgb);
        const anyTexture = this.prepareMaterialTextures(mesh);
        const uvs = mesh.uvs.raw;
        const vertexMaterial = mesh.vertexMaterial;
        const textureIds = this.materialTextureIds;
        const texelAreas = this.materialTexelAreas;
        const levelCounts = this.materialLevelCounts;

        const indices = mesh.triangles.raw;
        const triangleCount = mesh.triangleCount;

        for (let t = 0, k = 0; t < triangleCount; t++, k += 3) {
            const cornerA = indices[k] | 0, cornerB = indices[k + 1] | 0, cornerC = indices[k + 2] | 0;
            const ia = cornerA * 3, ib = cornerB * 3, ic = cornerC * 3;

            const ax = view[ia], ay = view[ia + 1], az = view[ia + 2];
            const bx = view[ib], by = view[ib + 1], bz = view[ib + 2];
            const cx = view[ic], cy = view[ic + 1], cz = view[ic + 2];
            const colorA = colors[cornerA], colorB = colors[cornerB], colorC = colors[cornerC];

            let textureId = TextureStore.NO_TEXTURE, texelArea = 0, levelCount = 1;
            let ua = 0, va = 0, ub = 0, vb = 0, uc = 0, vc = 0;
            if (anyTexture) {
                const material = vertexMaterial[cornerA];
                textureId = textureIds[material];
                if (textureId !== TextureStore.NO_TEXTURE) {
                    texelArea = texelAreas[material];
                    levelCount = levelCounts[material];
                    ua = uvs[ia]; va = 1 - uvs[ia + 1];
                    ub = uvs[ib]; vb = 1 - uvs[ib + 1];
                    uc = uvs[ic]; vc = 1 - uvs[ic + 1];
                }
            }

            const aIn = az >= NEAR_PLANE_Z;
            const bIn = bz >= NEAR_PLANE_Z;
            const cIn = cz >= NEAR_PLANE_Z;

            if (aIn && bIn && cIn) {
                this.emitTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, colorA, colorB, colorC, ua, va, ub, vb, uc, vc, textureId, texelArea, levelCount, focalLength, cellRatio);
                continue;
            }
            if (!aIn && !bIn && !cIn) continue;

            // Near-plane clipping. The triangle is rotated cyclically (a cyclic
            // rotation keeps the winding) so that the clipped-away vertex comes last
            // or the single surviving vertex comes first; the clipped pieces are then
            // emitted in that rotated order and keep the original winding.
            const insideMask = (aIn ? 1 : 0) | (bIn ? 2 : 0) | (cIn ? 4 : 0);
            if (insideMask === 1) {
                this.emitClippedCorner(ax, ay, az, colorA, ua, va, bx, by, bz, colorB, ub, vb, cx, cy, cz, colorC, uc, vc, textureId, texelArea, levelCount, focalLength, cellRatio);
            } else if (insideMask === 2) {
                this.emitClippedCorner(bx, by, bz, colorB, ub, vb, cx, cy, cz, colorC, uc, vc, ax, ay, az, colorA, ua, va, textureId, texelArea, levelCount, focalLength, cellRatio);
            } else if (insideMask === 4) {
                this.emitClippedCorner(cx, cy, cz, colorC, uc, vc, ax, ay, az, colorA, ua, va, bx, by, bz, colorB, ub, vb, textureId, texelArea, levelCount, focalLength, cellRatio);
            } else if (insideMask === 3) {
                this.emitClippedQuad(ax, ay, az, colorA, ua, va, bx, by, bz, colorB, ub, vb, cx, cy, cz, colorC, uc, vc, textureId, texelArea, levelCount, focalLength, cellRatio);
            } else if (insideMask === 6) {
                this.emitClippedQuad(bx, by, bz, colorB, ub, vb, cx, cy, cz, colorC, uc, vc, ax, ay, az, colorA, ua, va, textureId, texelArea, levelCount, focalLength, cellRatio);
            } else {
                this.emitClippedQuad(cx, cy, cz, colorC, uc, vc, ax, ay, az, colorA, ua, va, bx, by, bz, colorB, ub, vb, textureId, texelArea, levelCount, focalLength, cellRatio);
            }
        }
    }

    /** One vertex (p) in front of the near plane, q and r behind it: the piece is the triangle p, pq, pr. */
    private emitClippedCorner(
        px: number, py: number, pz: number, colorP: number, up: number, vp: number,
        qx: number, qy: number, qz: number, colorQ: number, uq: number, vq: number,
        rx: number, ry: number, rz: number, colorR: number, ur: number, vr: number,
        textureId: number, texelArea: number, levelCount: number, focalLength: number | undefined, cellRatio: number,
    ): void {
        const tq = (NEAR_PLANE_Z - pz) / (qz - pz);
        const tr = (NEAR_PLANE_Z - pz) / (rz - pz);
        this.emitTriangle(
            px, py, pz,
            px + tq * (qx - px), py + tq * (qy - py), NEAR_PLANE_Z,
            px + tr * (rx - px), py + tr * (ry - py), NEAR_PLANE_Z,
            colorP, lerpPackedColor(colorP, colorQ, tq), lerpPackedColor(colorP, colorR, tr),
            up, vp, up + tq * (uq - up), vp + tq * (vq - vp), up + tr * (ur - up), vp + tr * (vr - vp),
            textureId, texelArea, levelCount, focalLength, cellRatio,
        );
    }

    /** Two vertices (p, q) in front of the near plane, r behind it: the piece is the quad p, q, qr, pr as two triangles. */
    private emitClippedQuad(
        px: number, py: number, pz: number, colorP: number, up: number, vp: number,
        qx: number, qy: number, qz: number, colorQ: number, uq: number, vq: number,
        rx: number, ry: number, rz: number, colorR: number, ur: number, vr: number,
        textureId: number, texelArea: number, levelCount: number, focalLength: number | undefined, cellRatio: number,
    ): void {
        const tq = (NEAR_PLANE_Z - qz) / (rz - qz);
        const qrX = qx + tq * (rx - qx), qrY = qy + tq * (ry - qy);
        const colorQR = lerpPackedColor(colorQ, colorR, tq);
        const uQR = uq + tq * (ur - uq), vQR = vq + tq * (vr - vq);
        const tp = (NEAR_PLANE_Z - pz) / (rz - pz);
        const prX = px + tp * (rx - px), prY = py + tp * (ry - py);
        const colorPR = lerpPackedColor(colorP, colorR, tp);
        const uPR = up + tp * (ur - up), vPR = vp + tp * (vr - vp);
        this.emitTriangle(
            px, py, pz, qx, qy, qz, qrX, qrY, NEAR_PLANE_Z,
            colorP, colorQ, colorQR, up, vp, uq, vq, uQR, vQR,
            textureId, texelArea, levelCount, focalLength, cellRatio,
        );
        this.emitTriangle(
            px, py, pz, qrX, qrY, NEAR_PLANE_Z, prX, prY, NEAR_PLANE_Z,
            colorP, colorQR, colorPR, up, vp, uQR, vQR, uPR, vPR,
            textureId, texelArea, levelCount, focalLength, cellRatio,
        );
    }

    private fillVertexColors(colors: Int32Array, mesh: DeepReadonly<Mesh>, tint: number, vertexRgb: Float64Array | null): void {
        const vertCount = mesh.vertCount;
        if (vertexRgb !== null) {
            for (let i = 0, j = 0; i < vertCount; i++, j += 3) {
                colors[i] = packUnitRgb(vertexRgb[j], vertexRgb[j + 1], vertexRgb[j + 2]);
            }
            return;
        }
        const materials = mesh.materials;
        if (materials.length === 1) {
            colors.fill(multiplyPackedRgb(materials[0].diffuseColor, tint), 0, vertCount);
            return;
        }
        const materialColors = this.materialColors.length >= materials.length ? this.materialColors : (this.materialColors = new Int32Array(materials.length));
        for (let i = 0; i < materials.length; i++) {
            materialColors[i] = multiplyPackedRgb(materials[i].diffuseColor, tint);
        }
        const vertexMaterial = mesh.vertexMaterial;
        for (let i = 0; i < vertCount; i++) {
            colors[i] = materialColors[vertexMaterial[i]];
        }
    }

    /** Uploads the mesh's textures (once per Texture) and caches per-material lookups; false when nothing is textured. */
    private prepareMaterialTextures(mesh: DeepReadonly<Mesh>): boolean {
        if (!this.config.textures) return false;
        const materials = mesh.materials;
        if (this.materialTextureIds.length < materials.length) {
            this.materialTextureIds = new Int32Array(materials.length);
            this.materialTexelAreas = new Float64Array(materials.length);
            this.materialLevelCounts = new Int32Array(materials.length);
        }
        const store = this.textureStore;
        let anyTexture = false;
        for (let i = 0; i < materials.length; i++) {
            const texture = materials[i].diffuseTexture;
            const id = texture === undefined ? TextureStore.NO_TEXTURE : store.idOf(texture);
            this.materialTextureIds[i] = id;
            if (id === TextureStore.NO_TEXTURE) continue;
            anyTexture = true;
            this.materialTexelAreas[i] = store.baseTexelAreaOf(id);
            this.materialLevelCounts[i] = store.levelCountOf(id);
        }
        return anyTexture;
    }

    private emitTriangle(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        colorA: number, colorB: number, colorC: number,
        ua: number, va: number, ub: number, vb: number, uc: number, vc: number,
        textureId: number, texelArea: number, levelCount: number,
        focalLength: number | undefined, cellRatio: number,
    ): void {
        // View space is Y-up (world convention, and what .obj files store) while
        // screen rows grow downward, so the vertical axis flips during projection.
        let sax: number, say: number, sbx: number, sby: number, scx: number, scy: number;
        if (focalLength !== undefined) {
            const ppuA = focalLength / az, ppuB = focalLength / bz, ppuC = focalLength / cz;
            sax = this.halfWidth + ax * ppuA * cellRatio;
            say = this.halfHeight - ay * ppuA;
            sbx = this.halfWidth + bx * ppuB * cellRatio;
            sby = this.halfHeight - by * ppuB;
            scx = this.halfWidth + cx * ppuC * cellRatio;
            scy = this.halfHeight - cy * ppuC;
        } else {
            sax = this.halfWidth + ax * cellRatio;
            say = this.halfHeight - ay;
            sbx = this.halfWidth + bx * cellRatio;
            sby = this.halfHeight - by;
            scx = this.halfWidth + cx * cellRatio;
            scy = this.halfHeight - cy;
        }

        // Scale into the subsample grid (×1 when AA is off — bit-identical).
        const sx = this.supersampleX, sy = this.rowsPerCell;
        sax *= sx; say *= sy;
        sbx *= sx; sby *= sy;
        scx *= sx; scy *= sy;

        // Backface / degenerate cull: only one winding can ever pass the
        // kernel's inside test, so skip the rest before they cost anything.
        // Mirroring Y above reversed screen-space winding, so vertices are
        // emitted as A, C, B (see the pack below) and culled in that same order
        // — flipping the projection without this would cull exactly the faces
        // that should be visible and draw the ones that shouldn't.
        // A drawn back face is re-wound (B and C swapped) so the kernel still
        // sees the one winding it accepts.
        const area2 = (scx - sax) * (sby - say) - (scy - say) * (sbx - sax);
        if (area2 === 0) return;
        const isBackFace = area2 > 0;
        if (this.faceCulling === (isBackFace ? FaceCulling.BackFaces : FaceCulling.FrontFaces)) return;
        if (isBackFace) {
            let swap = sbx; sbx = scx; scx = swap;
            swap = sby; sby = scy; scy = swap;
            swap = bz; bz = cz; cz = swap;
            swap = colorB; colorB = colorC; colorC = swap;
            swap = ub; ub = uc; uc = swap;
            swap = vb; vb = vc; vc = swap;
        }

        // Off-screen cull + workload estimate for the threading heuristic.
        let minX = sax < sbx ? sax : sbx; if (scx < minX) minX = scx;
        let maxX = sax > sbx ? sax : sbx; if (scx > maxX) maxX = scx;
        let minY = say < sby ? say : sby; if (scy < minY) minY = scy;
        let maxY = say > sby ? say : sby; if (scy > maxY) maxY = scy;
        if (maxX <= 0 || minX >= this.rasterWidth || maxY <= 0 || minY >= this.rasterHeight) return;

        const clampedMinY = minY > 0 ? minY : 0;
        const clampedMaxY = maxY < this.rasterHeight ? maxY : this.rasterHeight;
        const clampedWidth = (maxX < this.rasterWidth ? maxX : this.rasterWidth) - (minX > 0 ? minX : 0);
        this.bboxAreaAccum += clampedWidth * (clampedMaxY - clampedMinY);

        if (this.triCount * TRI_STRIDE >= this.triData.length) {
            if (this.usingPool) {
                // Shared batch is full — rasterize and merge what we have, then reuse it.
                this.flushBatch(true);
            } else {
                const grown = new Float32Array(this.triData.length * 2);
                grown.set(this.triData);
                this.triData = grown;
                this.localTriData = grown;
                this.triInts = new Int32Array(grown.buffer);
                this.localTriInts = this.triInts;
            }
        }

        const o = this.triCount * TRI_STRIDE;
        const tris = this.triData;
        const ints = this.triInts;
        // Packed as A, C, B — the Y mirror's winding fix. Each slot's 1/z, color
        // and uv stay paired with their own vertex, so interpolation is unaffected.
        tris[o] = sax;
        tris[o + 1] = say;
        tris[o + 2] = scx;
        tris[o + 3] = scy;
        tris[o + 4] = sbx;
        tris[o + 5] = sby;
        tris[o + 6] = 1 / az;
        tris[o + 7] = 1 / cz;
        tris[o + 8] = 1 / bz;
        ints[o + 9] = colorA;
        ints[o + 10] = colorC;
        ints[o + 11] = colorB;
        ints[o + 18] = textureId;
        if (textureId !== TextureStore.NO_TEXTURE) {
            tris[o + 12] = ua;
            tris[o + 13] = va;
            tris[o + 14] = uc;
            tris[o + 15] = vc;
            tris[o + 16] = ub;
            tris[o + 17] = vb;
            ints[o + 19] = mipLevelFor(ua, va, ub, vb, uc, vc, texelArea, -area2, levelCount);
        }

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
        const {rasterWidth, rasterHeight, config, subsamplesPerCell} = this;
        const singleSample = subsamplesPerCell === 1;
        // When supersampling, quantize after the resolve average instead of per
        // subsample, otherwise the average un-quantizes the colors again.
        const quantMask = singleSample ? config.colorQuantMask & 0xFFFFFF : 0xFFFFFF;

        const pool = this.usingPool ? this.pool : undefined;
        const threaded = pool !== undefined
            && (this.triCount >= config.threadTriangleThreshold || this.bboxAreaAccum >= config.threadAreaThreshold * this.subsamplesPerCell);

        if (threaded) {
            if (!pool!.dispatch(this.triCount, rasterWidth, rasterHeight, config.maxDepthFade, quantMask)) {
                // Pool broke mid-frame; dispatch() already completed the layers
                // synchronously. Future frames go single-threaded.
                this.poolBroken = true;
            }
        } else {
            const store = this.textureStore;
            rasterizeTriangleBand(this.triData, this.triInts, this.triCount, null, 0, 0, this.depthLayer, this.colorLayer, store.texels, store.table, rasterWidth, 0, rasterHeight, config.maxDepthFade, quantMask);
        }

        this.target.composite(this.layers);
        this.triCount = 0;
        this.bboxAreaAccum = 0;
        if (prepareForMore) {
            this.depthLayer.fill(Number.POSITIVE_INFINITY, 0, rasterWidth * rasterHeight);
            if (this.usingPool) this.pool!.bandCounts.fill(0);
        }
    }

    /** Rasterize any queued triangles and hand them to the target. */
    public endFrame(): void {
        this.flushBatch(false);
    }

    public dispose(): void {
        this.pool?.dispose();
        this.pool = undefined;
    }
}

/**
 * Mip level whose texel density best matches the triangle's screen density:
 * log2 of the ratio between texels covered and subsamples covered, rounded.
 */
function mipLevelFor(ua: number, va: number, ub: number, vb: number, uc: number, vc: number, texelArea: number, screenArea2: number, levelCount: number): number {
    const uvArea2 = Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va));
    if (uvArea2 === 0 || screenArea2 <= 0) return 0;
    const ratio = uvArea2 * texelArea / screenArea2;
    const level = Math.round(Math.log(ratio) / LOG2 / 2);
    return level <= 0 ? 0 : level >= levelCount ? levelCount - 1 : level;
}
