/**
 * Triangle rasterization kernel for the console 3D render pass.
 *
 * IMPORTANT: rasterizeTriangleBand is also serialized with Function.prototype.toString()
 * and evaluated inside worker threads (see rasterWorkerPool.ts). It must stay fully
 * self-contained: no imports, no closure captures, no engine types — only its
 * parameters and true globals (Math). Keep the syntax plain so transpilers emit it 1:1.
 * That is also why the stride is a literal inside the function body rather than a
 * reference to TRI_STRIDE: keep the two in sync.
 *
 * Triangle payload layout (stride TRI_STRIDE doubles per triangle):
 *   [0] x0  [1] y0   screen-space vertex A
 *   [2] x1  [3] y1   screen-space vertex B
 *   [4] x2  [5] y2   screen-space vertex C
 *   [6] izA [7] izB [8] izC   1/viewDepth per vertex (perspective-correct interpolation)
 *   [9] colorA [10] colorB [11] colorC   packed 0xRRGGBB per vertex
 *
 * Colors are unpacked per triangle and interpolated across it (Gouraud). A
 * triangle whose three vertex colors are equal reproduces that color exactly,
 * because the interpolation is written as A plus weighted deltas and the deltas
 * are zero. One packed int per vertex instead of three floats keeps the batch
 * small enough to stay cache-resident at 45k triangles (measured on the plant mesh:
 * 18 doubles per triangle cost +25% raster time, 12 cost +5%).
 *
 * Depth/color layers are flat row-major [y * width + x] arrays. Callers hand each
 * invocation a disjoint row band [yStart, yEnd), which is what makes the parallel
 * version race-free without any per-pixel synchronization.
 */
export const TRI_STRIDE = 12;

/**
 * indexList (optional) holds the indices of the triangles this band actually
 * overlaps (built at pack time), so parallel bands don't each pay per-triangle
 * setup for the whole scene. Pass null to iterate all triCount triangles.
 */
export function rasterizeTriangleBand(
    tris: Float64Array,
    triCount: number,
    indexList: Int32Array | null,
    indexStart: number,
    indexCount: number,
    depthLayer: Float32Array,
    colorLayer: Int32Array,
    width: number,
    yStart: number,
    yEnd: number,
    maxDepthFade: number,
    quantMask: number,
): void {
    const NEAR = 0.1;
    const strideDoubles = 12;
    const invFade = 1 / maxDepthFade;
    const iterations = indexList === null ? triCount : indexCount;

    for (let i = 0; i < iterations; i++) {
        const t = indexList === null ? i : indexList[indexStart + i];
        const o = t * strideDoubles;
        const x0 = tris[o], y0 = tris[o + 1];
        const x1 = tris[o + 2], y1 = tris[o + 3];
        const x2 = tris[o + 4], y2 = tris[o + 5];
        const izA = tris[o + 6], izB = tris[o + 7], izC = tris[o + 8];
        const colorA = tris[o + 9] | 0, colorB = tris[o + 10] | 0, colorC = tris[o + 11] | 0;
        const rA = (colorA >> 16) & 255, gA = (colorA >> 8) & 255, bA = colorA & 255;
        const rDeltaB = ((colorB >> 16) & 255) - rA, gDeltaB = ((colorB >> 8) & 255) - gA, bDeltaB = (colorB & 255) - bA;
        const rDeltaC = ((colorC >> 16) & 255) - rA, gDeltaC = ((colorC >> 8) & 255) - gA, bDeltaC = (colorC & 255) - bA;

        // Bounding box, clamped to this band
        let minXf = x0 < x1 ? x0 : x1; if (x2 < minXf) minXf = x2;
        let maxXf = x0 > x1 ? x0 : x1; if (x2 > maxXf) maxXf = x2;
        let minYf = y0 < y1 ? y0 : y1; if (y2 < minYf) minYf = y2;
        let maxYf = y0 > y1 ? y0 : y1; if (y2 > maxYf) maxYf = y2;

        let minX = Math.floor(minXf); if (minX < 0) minX = 0;
        let maxX = Math.ceil(maxXf); if (maxX > width) maxX = width;
        let minY = Math.floor(minYf); if (minY < yStart) minY = yStart;
        let maxY = Math.ceil(maxYf); if (maxY > yEnd) maxY = yEnd;
        if (minX >= maxX || minY >= maxY) continue;

        // Edge functions E(x, y) = A*x + B*y + C, each equal to twice the signed
        // area of (edge, point). Sample points are integer cell coords, matching
        // the previous per-pixel pointInTriangle sampling exactly.
        const aAB = y0 - y1, bAB = x1 - x0, cAB = (y1 - y0) * x0 - (x1 - x0) * y0;
        const aBC = y1 - y2, bBC = x2 - x1, cBC = (y2 - y1) * x1 - (x2 - x1) * y1;
        const aCA = y2 - y0, bCA = x0 - x2, cCA = (y0 - y2) * x2 - (x0 - x2) * y2;

        // Twice the signed area of the whole triangle. Only one winding is ever
        // visible (inside test needs every edge value <= 0), so cull the rest here.
        const area2 = aAB * x2 + bAB * y2 + cAB;
        if (area2 >= 0) continue;
        const invArea = 1 / area2;

        let rowAB = aAB * minX + bAB * minY + cAB;
        let rowBC = aBC * minX + bBC * minY + cBC;
        let rowCA = aCA * minX + bCA * minY + cCA;

        for (let y = minY; y < maxY; y++) {
            let eAB = rowAB, eBC = rowBC, eCA = rowCA;
            const rowIndex = y * width;

            for (let x = minX; x < maxX; x++) {
                if (eAB <= 0 && eBC <= 0 && eCA <= 0) {
                    // Barycentric weights (all non-negative: negative/negative)
                    const wA = eBC * invArea;
                    const wB = eCA * invArea;
                    const wC = eAB * invArea;

                    const iz = izA * wA + izB * wB + izC * wC;
                    const depth = 1 / iz;

                    if (depth >= NEAR) {
                        const idx = rowIndex + x;
                        if (!(depthLayer[idx] < depth)) {
                            let fade = 1 - depth * invFade;
                            if (fade < 0) fade = 0;
                            else if (fade > 1) fade = 1;

                            let rVertex = rA + rDeltaB * wB + rDeltaC * wC;
                            let gVertex = gA + gDeltaB * wB + gDeltaC * wC;
                            let bVertex = bA + bDeltaB * wB + bDeltaC * wC;
                            if (rVertex > 255) rVertex = 255;
                            if (gVertex > 255) gVertex = 255;
                            if (bVertex > 255) bVertex = 255;

                            const r = Math.ceil(fade * rVertex);
                            const g = Math.ceil(fade * gVertex);
                            const b = Math.ceil(fade * bVertex);

                            depthLayer[idx] = depth;
                            colorLayer[idx] = ((r << 16) | (g << 8) | b) & quantMask;
                        }
                    }
                }
                eAB += aAB;
                eBC += aBC;
                eCA += aCA;
            }
            rowAB += bAB;
            rowBC += bBC;
            rowCA += bCA;
        }
    }
}
