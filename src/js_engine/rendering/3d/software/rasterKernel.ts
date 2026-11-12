export const TRI_STRIDE = 20;

export function rasterizeTriangleBand(
    trisF: Float32Array,
    trisI: Int32Array,
    triCount: number,
    indexListOrNull: Int32Array | null,
    indexStart: number,
    indexCount: number,
    depthLayer: Float32Array,
    colorLayer: Int32Array,
    texels: Int32Array,
    textureTable: Int32Array,
    width: number,
    yStart: number,
    yEnd: number,
    maxDepthFade: number,
    quantMask: number,
): void {
    const NEAR = 0.1;
    const strideSlots = 20;
    const descriptorStride = 49;
    const levelStride = 3;
    const descriptorLevelsOffset = 1;
    const cellCenter = 0.5;
    const alphaCutoff = 128;
    const channelMax = 255;
    const invFade = 1 / maxDepthFade;
    const iterations = indexListOrNull === null ? triCount : indexCount;

    for (let i = 0; i < iterations; i++) {
        const t = indexListOrNull === null ? i : indexListOrNull[indexStart + i];
        const o = t * strideSlots;
        const x0 = trisF[o], y0 = trisF[o + 1];
        const x1 = trisF[o + 2], y1 = trisF[o + 3];
        const x2 = trisF[o + 4], y2 = trisF[o + 5];
        const izA = trisF[o + 6], izB = trisF[o + 7], izC = trisF[o + 8];
        const colorA = trisI[o + 9], colorB = trisI[o + 10], colorC = trisI[o + 11];
        const rA = (colorA >> 16) & 255, gA = (colorA >> 8) & 255, bA = colorA & 255;
        const rDeltaB = ((colorB >> 16) & 255) - rA, gDeltaB = ((colorB >> 8) & 255) - gA, bDeltaB = (colorB & 255) - bA;
        const rDeltaC = ((colorC >> 16) & 255) - rA, gDeltaC = ((colorC >> 8) & 255) - gA, bDeltaC = (colorC & 255) - bA;

        const textureId = trisI[o + 18];
        const textured = textureId >= 0;
        let levelOffset = 0, levelWidth = 1, levelHeight = 1;
        let uzA = 0, uzB = 0, uzC = 0, vzA = 0, vzB = 0, vzC = 0;
        if (textured) {
            const entry = textureId * descriptorStride + descriptorLevelsOffset + trisI[o + 19] * levelStride;
            levelOffset = textureTable[entry];
            levelWidth = textureTable[entry + 1];
            levelHeight = textureTable[entry + 2];
            uzA = trisF[o + 12] * izA; vzA = trisF[o + 13] * izA;
            uzB = trisF[o + 14] * izB; vzB = trisF[o + 15] * izB;
            uzC = trisF[o + 16] * izC; vzC = trisF[o + 17] * izC;
        }

        let minXf = x0 < x1 ? x0 : x1; if (x2 < minXf) minXf = x2;
        let maxXf = x0 > x1 ? x0 : x1; if (x2 > maxXf) maxXf = x2;
        let minYf = y0 < y1 ? y0 : y1; if (y2 < minYf) minYf = y2;
        let maxYf = y0 > y1 ? y0 : y1; if (y2 > maxYf) maxYf = y2;

        let minX = Math.floor(minXf); if (minX < 0) minX = 0;
        let maxX = Math.ceil(maxXf); if (maxX > width) maxX = width;
        let minY = Math.floor(minYf); if (minY < yStart) minY = yStart;
        let maxY = Math.ceil(maxYf); if (maxY > yEnd) maxY = yEnd;
        if (minX >= maxX || minY >= maxY) continue;

        const aAB = y0 - y1, bAB = x1 - x0, cAB = (y1 - y0) * x0 - (x1 - x0) * y0;
        const aBC = y1 - y2, bBC = x2 - x1, cBC = (y2 - y1) * x1 - (x2 - x1) * y1;
        const aCA = y2 - y0, bCA = x0 - x2, cCA = (y0 - y2) * x2 - (x0 - x2) * y2;

        const area2 = aAB * x2 + bAB * y2 + cAB;
        if (area2 >= 0) continue;
        const invArea = 1 / area2;

        const sampleX = minX + cellCenter, sampleY = minY + cellCenter;
        let rowAB = aAB * sampleX + bAB * sampleY + cAB;
        let rowBC = aBC * sampleX + bBC * sampleY + cBC;
        let rowCA = aCA * sampleX + bCA * sampleY + cCA;

        for (let y = minY; y < maxY; y++) {
            let eAB = rowAB, eBC = rowBC, eCA = rowCA;
            const rowIndex = y * width;

            for (let x = minX; x < maxX; x++) {
                if (eAB <= 0 && eBC <= 0 && eCA <= 0) {
                    const wA = eBC * invArea;
                    const wB = eCA * invArea;
                    const wC = eAB * invArea;

                    const iz = izA * wA + izB * wB + izC * wC;
                    const depth = 1 / iz;

                    if (depth >= NEAR) {
                        const idx = rowIndex + x;
                        if (!(depthLayer[idx] < depth)) {
                            let rVertex = rA + rDeltaB * wB + rDeltaC * wC;
                            let gVertex = gA + gDeltaB * wB + gDeltaC * wC;
                            let bVertex = bA + bDeltaB * wB + bDeltaC * wC;
                            if (rVertex > channelMax) rVertex = channelMax;
                            if (gVertex > channelMax) gVertex = channelMax;
                            if (bVertex > channelMax) bVertex = channelMax;

                            let visible = true;
                            if (textured) {
                                const u = (uzA * wA + uzB * wB + uzC * wC) * depth;
                                const v = (vzA * wA + vzB * wB + vzC * wC) * depth;
                                const tx = ((u - Math.floor(u)) * levelWidth) | 0;
                                const ty = ((v - Math.floor(v)) * levelHeight) | 0;
                                const texel = texels[levelOffset + ty * levelWidth + tx];
                                if ((texel >>> 24) < alphaCutoff) {
                                    visible = false;
                                } else {
                                    rVertex = ((texel >> 16) & 255) * rVertex / channelMax;
                                    gVertex = ((texel >> 8) & 255) * gVertex / channelMax;
                                    bVertex = (texel & 255) * bVertex / channelMax;
                                }
                            }

                            if (visible) {
                                let fade = 1 - depth * invFade;
                                if (fade < 0) fade = 0;
                                else if (fade > 1) fade = 1;

                                const r = Math.ceil(fade * rVertex);
                                const g = Math.ceil(fade * gVertex);
                                const b = Math.ceil(fade * bVertex);

                                depthLayer[idx] = depth;
                                colorLayer[idx] = ((r << 16) | (g << 8) | b) & quantMask;
                            }
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
