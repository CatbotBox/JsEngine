import type {MeshParts} from "./mesh";
import type {Material} from "./material";

export interface LodBuildOptions {
    minTriangles: number;
    levelReduction: number;
    maxLevels: number;
    minLevelTriangles: number;
    minReduction: number;
    maxResolution: number;
}

export const DEFAULT_LOD_BUILD_OPTIONS: LodBuildOptions = {
    minTriangles: 20_000,
    levelReduction: 4,
    maxLevels: 4,
    minLevelTriangles: 2_000,
    minReduction: 1.25,
    maxResolution: 4096,
};

const PROBE_RESOLUTION = 256;
const TARGET_TOLERANCE = 1.4;
const MAX_RESOLUTION_CORRECTIONS = 8;
const UV_SPREAD_SLACK = 2;
const UV_SPREAD_SLACK_SQUARED = UV_SPREAD_SLACK * UV_SPREAD_SLACK;
const UV_MATCH_EPSILON = 1e-5;
const UV_MATCH_EPSILON_SQUARED = UV_MATCH_EPSILON * UV_MATCH_EPSILON;
const NO_CLUSTER = -1;
const MAX_UV_CLUSTERS_PER_CELL = 8;
const POSITION_STRIDE = 3;
const UV_STRIDE = 3;
const TRIANGLE_CORNERS = 3;

export interface LodSourceMesh {
    readonly vertCount: number;
    readonly triangleCount: number;
    readonly vertices: {readonly raw: Float32Array};
    readonly normals: {readonly raw: Float32Array};
    readonly uvs: {readonly raw: Float32Array};
    readonly triangles: {readonly raw: Float32Array};
    readonly vertexMaterial: Uint16Array;
    readonly materials: readonly Material[];
    readonly bounds: Float32Array;
}

export function buildLodParts(source: LodSourceMesh, options: Partial<LodBuildOptions> = {}): MeshParts[] {
    const settings = {...DEFAULT_LOD_BUILD_OPTIONS, ...options};
    const levels: MeshParts[] = [];
    if (source.triangleCount < settings.minTriangles) return levels;

    const uvSpreadSquared = hasUniformUvs(source) ? undefined : squaredUvSpreadPerUnitLength(source);
    let previousTriangleCount = source.triangleCount;
    let resolution = Math.min(PROBE_RESOLUTION, settings.maxResolution);
    for (let level = 0; level < settings.maxLevels; level++) {
        const target = previousTriangleCount / settings.levelReduction;
        let parts = clusterVertices(source, uvSpreadSquared, resolution);
        let lastProbeCount = -1;
        for (let correction = 0; correction < MAX_RESOLUTION_CORRECTIONS && parts.triangleCount > 0 && !withinTolerance(parts.triangleCount, target); correction++) {
            let corrected = resolutionToward(resolution, parts.triangleCount, target, settings.maxResolution);
            const noProgress = parts.triangleCount === lastProbeCount || corrected === resolution;
            if (noProgress) corrected = parts.triangleCount > target ? Math.floor(resolution / 2) : Math.min(settings.maxResolution, resolution * 2);
            if (corrected < 1 || corrected === resolution) break;
            lastProbeCount = parts.triangleCount;
            resolution = corrected;
            parts = clusterVertices(source, uvSpreadSquared, resolution);
        }
        if (parts.triangleCount === 0 || parts.triangleCount * settings.minReduction > previousTriangleCount) break;
        levels.push(parts);
        previousTriangleCount = parts.triangleCount;
        if (parts.triangleCount < settings.minLevelTriangles) break;
        resolution = resolutionToward(resolution, parts.triangleCount, parts.triangleCount / settings.levelReduction, settings.maxResolution);
    }
    return levels;
}

function withinTolerance(triangleCount: number, target: number): boolean {
    return triangleCount <= target * TARGET_TOLERANCE && triangleCount * TARGET_TOLERANCE >= target;
}

function resolutionToward(resolution: number, triangleCount: number, target: number, maxResolution: number): number {
    const scaled = Math.round(resolution * Math.sqrt(target / triangleCount));
    return Math.max(1, Math.min(maxResolution, scaled));
}

export function selectLodLevel(lods: readonly {readonly triangleCount: number}[], projectedWidth: number, projectedHeight: number, trianglesPerSample: number, bias = 0): number {
    const last = lods.length - 1;
    if (last <= 0) return 0;
    const budget = trianglesPerSample * projectedWidth * projectedHeight;
    let level = last;
    for (let i = 0; i <= last; i++) {
        if (lods[i].triangleCount <= budget) {
            level = i;
            break;
        }
    }
    level += Math.trunc(bias);
    return level < 0 ? 0 : level > last ? last : level;
}

function hasUniformUvs(source: LodSourceMesh): boolean {
    const uvs = source.uvs.raw;
    const firstU = uvs[0], firstV = uvs[1];
    for (let t = 0; t < source.vertCount * UV_STRIDE; t += UV_STRIDE) {
        if (uvs[t] !== firstU || uvs[t + 1] !== firstV) return false;
    }
    return true;
}

function squaredUvSpreadPerUnitLength(source: LodSourceMesh): Float32Array {
    const positions = source.vertices.raw;
    const uvs = source.uvs.raw;
    const triangles = source.triangles.raw;
    const spread = new Float32Array(source.vertCount);
    for (let k = 0; k < triangles.length; k += TRIANGLE_CORNERS) {
        for (let corner = 0; corner < TRIANGLE_CORNERS; corner++) {
            const from = triangles[k + corner] | 0;
            const to = triangles[k + (corner + 1) % TRIANGLE_CORNERS] | 0;
            const p = from * POSITION_STRIDE, q = to * POSITION_STRIDE;
            const dx = positions[q] - positions[p], dy = positions[q + 1] - positions[p + 1], dz = positions[q + 2] - positions[p + 2];
            const lengthSquared = dx * dx + dy * dy + dz * dz;
            if (lengthSquared === 0) continue;
            const t = from * UV_STRIDE, u = to * UV_STRIDE;
            const du = uvs[u] - uvs[t], dv = uvs[u + 1] - uvs[t + 1];
            const ratioSquared = (du * du + dv * dv) / lengthSquared;
            if (ratioSquared > spread[from]) spread[from] = ratioSquared;
            if (ratioSquared > spread[to]) spread[to] = ratioSquared;
        }
    }
    return spread;
}

function sharesSurfaceUv(positions: Float32Array, uvs: Float32Array, uvSpreadSquared: Float32Array, a: number, b: number): boolean {
    const p = a * POSITION_STRIDE, q = b * POSITION_STRIDE;
    const dx = positions[q] - positions[p], dy = positions[q + 1] - positions[p + 1], dz = positions[q + 2] - positions[p + 2];
    const t = a * UV_STRIDE, u = b * UV_STRIDE;
    const du = uvs[u] - uvs[t], dv = uvs[u + 1] - uvs[t + 1];
    const spreadA = uvSpreadSquared[a], spreadB = uvSpreadSquared[b];
    const allowedSpreadSquared = UV_SPREAD_SLACK_SQUARED * (spreadA > spreadB ? spreadA : spreadB);
    return du * du + dv * dv <= allowedSpreadSquared * (dx * dx + dy * dy + dz * dz) + UV_MATCH_EPSILON_SQUARED;
}

function clusterVertices(source: LodSourceMesh, uvSpreadSquared: Float32Array | undefined, resolution: number): MeshParts {
    const vertCount = source.vertCount;
    const positions = source.vertices.raw;
    const normals = source.normals.raw;
    const uvs = source.uvs.raw;
    const vertexMaterial = source.vertexMaterial;
    const materialCount = Math.max(1, source.materials.length);
    const bounds = source.bounds;

    const extentX = bounds[3] - bounds[0], extentY = bounds[4] - bounds[1], extentZ = bounds[5] - bounds[2];
    const longest = Math.max(extentX, extentY, extentZ);
    const cellSize = longest > 0 ? longest / resolution : 1;
    const cellsX = Math.max(1, Math.ceil(extentX / cellSize));
    const cellsY = Math.max(1, Math.ceil(extentY / cellSize));
    const cellsZ = Math.max(1, Math.ceil(extentZ / cellSize));

    const clusterOfVertex = new Int32Array(vertCount);
    const clusterByKey = new Map<number, number>();
    const sumPosition = new Float32Array(vertCount * 3);
    const sumNormal = new Float32Array(vertCount * 3);
    const sumUv = new Float32Array(vertCount * 2);
    const memberCount = new Int32Array(vertCount);
    const clusterMaterial = new Uint16Array(vertCount);
    const clusterAnchor = new Int32Array(vertCount);
    const nextClusterInCell = new Int32Array(vertCount);
    let clusterCount = 0;

    for (let v = 0, p = 0, t = 0; v < vertCount; v++, p += 3, t += 3) {
        let gx = Math.floor((positions[p] - bounds[0]) / cellSize);
        let gy = Math.floor((positions[p + 1] - bounds[1]) / cellSize);
        let gz = Math.floor((positions[p + 2] - bounds[2]) / cellSize);
        if (gx >= cellsX) gx = cellsX - 1; else if (gx < 0) gx = 0;
        if (gy >= cellsY) gy = cellsY - 1; else if (gy < 0) gy = 0;
        if (gz >= cellsZ) gz = cellsZ - 1; else if (gz < 0) gz = 0;
        const material = vertexMaterial[v];
        const key = ((gx * cellsY + gy) * cellsZ + gz) * materialCount + material;

        const firstInCell = clusterByKey.get(key) ?? NO_CLUSTER;
        let cluster = firstInCell;
        if (uvSpreadSquared !== undefined) {
            for (let walked = 0; cluster !== NO_CLUSTER && walked < MAX_UV_CLUSTERS_PER_CELL && !sharesSurfaceUv(positions, uvs, uvSpreadSquared, clusterAnchor[cluster], v); walked++) {
                cluster = nextClusterInCell[cluster];
            }
        }
        if (cluster === NO_CLUSTER) {
            cluster = clusterCount++;
            clusterMaterial[cluster] = material;
            clusterAnchor[cluster] = v;
            nextClusterInCell[cluster] = firstInCell;
            clusterByKey.set(key, cluster);
        }
        clusterOfVertex[v] = cluster;
        const c3 = cluster * 3, c2 = cluster * 2;
        sumPosition[c3] += positions[p];
        sumPosition[c3 + 1] += positions[p + 1];
        sumPosition[c3 + 2] += positions[p + 2];
        sumNormal[c3] += normals[p];
        sumNormal[c3 + 1] += normals[p + 1];
        sumNormal[c3 + 2] += normals[p + 2];
        sumUv[c2] += uvs[t];
        sumUv[c2 + 1] += uvs[t + 1];
        memberCount[cluster]++;
    }

    const sourceTriangles = source.triangles.raw;
    const survivingCorners = new Int32Array(source.triangleCount * 3);
    let survivingTriangleCount = 0;
    for (let k = 0; k < sourceTriangles.length; k += 3) {
        const a = clusterOfVertex[sourceTriangles[k] | 0];
        const b = clusterOfVertex[sourceTriangles[k + 1] | 0];
        const c = clusterOfVertex[sourceTriangles[k + 2] | 0];
        if (a === b || b === c || a === c) continue;
        const o = survivingTriangleCount * 3;
        survivingCorners[o] = a;
        survivingCorners[o + 1] = b;
        survivingCorners[o + 2] = c;
        survivingTriangleCount++;
    }

    const compactIndex = new Int32Array(clusterCount).fill(-1);
    let usedClusterCount = 0;
    for (let i = 0; i < survivingTriangleCount * 3; i++) {
        const cluster = survivingCorners[i];
        if (compactIndex[cluster] === -1) compactIndex[cluster] = usedClusterCount++;
    }

    const data = new Float32Array((usedClusterCount * 3 + survivingTriangleCount) * 3);
    const normalOffset = usedClusterCount * 3;
    const uvOffset = normalOffset * 2;
    const triangleOffset = normalOffset * 3;
    const outMaterial = new Uint16Array(usedClusterCount);
    for (let cluster = 0; cluster < clusterCount; cluster++) {
        const out = compactIndex[cluster];
        if (out === -1) continue;
        const invCount = 1 / memberCount[cluster];
        const c3 = cluster * 3, c2 = cluster * 2, o3 = out * 3;
        data[o3] = sumPosition[c3] * invCount;
        data[o3 + 1] = sumPosition[c3 + 1] * invCount;
        data[o3 + 2] = sumPosition[c3 + 2] * invCount;
        const nx = sumNormal[c3], ny = sumNormal[c3 + 1], nz = sumNormal[c3 + 2];
        const normalLength = Math.hypot(nx, ny, nz);
        const invNormal = normalLength > 0 ? 1 / normalLength : 0;
        data[normalOffset + o3] = nx * invNormal;
        data[normalOffset + o3 + 1] = ny * invNormal;
        data[normalOffset + o3 + 2] = nz * invNormal;
        data[uvOffset + o3] = sumUv[c2] * invCount;
        data[uvOffset + o3 + 1] = sumUv[c2 + 1] * invCount;
        outMaterial[out] = clusterMaterial[cluster];
    }
    for (let i = 0; i < survivingTriangleCount * 3; i++) {
        data[triangleOffset + i] = compactIndex[survivingCorners[i]];
    }

    return {
        data,
        vertCount: usedClusterCount,
        triangleCount: survivingTriangleCount,
        materials: source.materials,
        vertexMaterial: outMaterial,
    };
}
