import type {DecodedImage} from "../../engine/assets/image/decodedImage";
import {Mesh} from "../../engine/rendering/3d/mesh";
import type {ProjectEntry} from "../project/projectFileSystem";
import {decodeProjectImage} from "./projectImages";
import {isImageKind, normalizeProjectPath, projectFileKind} from "./projectFiles";

export type Thumbnail =
    | {readonly kind: "image", readonly image: DecodedImage}
    | {readonly kind: "icon", readonly reason: string};

const BYTES_PER_MEGABYTE = 1024 * 1024;

export const THUMBNAIL_SIZE_PX = 64;
export const MAX_CACHED_THUMBNAILS = 256;
export const MAX_IMAGE_THUMBNAIL_BYTES = 16 * BYTES_PER_MEGABYTE;
export const MAX_MESH_THUMBNAIL_BYTES = 8 * BYTES_PER_MEGABYTE;
export const MAX_MESH_THUMBNAIL_TRIANGLES = 200_000;
export const EMPTY_MESH_REASON = "The mesh has no triangles";

export interface MeshView {
    readonly yawRadians: number;
    readonly pitchRadians: number;
}

export type MeshFit = "silhouette" | "sphere";

export const DEFAULT_MESH_VIEW: MeshView = {yawRadians: -Math.PI / 5, pitchRadians: Math.PI / 8};

const RGBA_CHANNELS = 4;
const OPAQUE = 255;
const FIT_MARGIN_FRACTION = 0.08;
const AMBIENT_LIGHT = 0.3;
const DIFFUSE_LIGHT = 0.7;
const LIGHT_DIRECTION: readonly [number, number, number] = [0.35, 0.6, 0.72];
const MESH_BASE_RGB: readonly [number, number, number] = [196, 206, 222];
const CORNERS_PER_TRIANGLE = 3;
const COMPONENTS_PER_POSITION = 3;
const NO_DEPTH = Number.NEGATIVE_INFINITY;
const PIXEL_CENTER = 0.5;
const NOT_PREVIEWED_REASON = "No thumbnail for this kind of file";
const TEXT_DECODER_OPTIONS = {ignoreBOM: true} as const;

export function thumbnailKey(entry: Pick<ProjectEntry, "path" | "mtimeMs" | "size">): string {
    return `${normalizeProjectPath(entry.path)}@${entry.mtimeMs}:${entry.size}`;
}

export function hasThumbnail(path: string): boolean {
    const kind = projectFileKind(path);
    return isImageKind(kind) || kind === "mesh";
}

type ThumbnailSource = Pick<ProjectEntry, "path" | "mtimeMs" | "size">;

interface CachedThumbnail<T> {
    readonly made: Promise<T>;
    value?: T;
}

export class ThumbnailCache<T> {
    private readonly byKey = new Map<string, CachedThumbnail<T>>();
    private readonly keyOfPath = new Map<string, string>();

    public constructor(private readonly limit: number = MAX_CACHED_THUMBNAILS) {
    }

    public get size(): number {
        return this.byKey.size;
    }

    public has(entry: ThumbnailSource): boolean {
        return this.byKey.has(thumbnailKey(entry));
    }

    public peek(entry: ThumbnailSource): T | undefined {
        return this.byKey.get(thumbnailKey(entry))?.value;
    }

    public get(entry: ThumbnailSource, make: () => Promise<T>): Promise<T> {
        const key = thumbnailKey(entry);
        const path = normalizeProjectPath(entry.path);
        const cached = this.byKey.get(key);
        if (cached !== undefined) {
            this.byKey.delete(key);
            this.byKey.set(key, cached);
            return cached.made;
        }
        const stale = this.keyOfPath.get(path);
        if (stale !== undefined) this.byKey.delete(stale);
        const made = make();
        const created: CachedThumbnail<T> = {made};
        void made.then(value => created.value = value, () => this.byKey.get(key) === created && this.byKey.delete(key));
        this.byKey.set(key, created);
        this.keyOfPath.set(path, key);
        this.evictPastLimit();
        return made;
    }

    public clear(): void {
        this.byKey.clear();
        this.keyOfPath.clear();
    }

    private evictPastLimit(): void {
        while (this.byKey.size > this.limit) {
            const oldest = this.byKey.keys().next().value;
            if (oldest === undefined) return;
            this.byKey.delete(oldest);
            for (const [path, key] of this.keyOfPath) {
                if (key !== oldest) continue;
                this.keyOfPath.delete(path);
                break;
            }
        }
    }
}

export function downscaledImage(image: DecodedImage, maxSize: number): DecodedImage {
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height, 1));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    if (width === image.width && height === image.height) return image;
    const rgba = new Uint8Array(width * height * RGBA_CHANNELS);
    for (let y = 0; y < height; y++) {
        const sourceTop = Math.floor(y * image.height / height);
        const sourceBottom = Math.max(sourceTop + 1, Math.floor((y + 1) * image.height / height));
        for (let x = 0; x < width; x++) {
            const sourceLeft = Math.floor(x * image.width / width);
            const sourceRight = Math.max(sourceLeft + 1, Math.floor((x + 1) * image.width / width));
            const sums = [0, 0, 0, 0];
            for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY++) {
                for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX++) {
                    const offset = (sourceY * image.width + sourceX) * RGBA_CHANNELS;
                    for (let channel = 0; channel < RGBA_CHANNELS; channel++) sums[channel] += image.rgba[offset + channel];
                }
            }
            const count = (sourceBottom - sourceTop) * (sourceRight - sourceLeft);
            const target = (y * width + x) * RGBA_CHANNELS;
            for (let channel = 0; channel < RGBA_CHANNELS; channel++) rgba[target + channel] = Math.round(sums[channel] / count);
        }
    }
    return {width, height, rgba};
}

interface ViewPoint {
    readonly x: number;
    readonly y: number;
    readonly depth: number;
}

interface ViewFrame {
    readonly left: number;
    readonly top: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly scale: number;
}

function rotatedPositions(positions: Float32Array, vertexCount: number, view: MeshView): Float32Array {
    const cosYaw = Math.cos(view.yawRadians), sinYaw = Math.sin(view.yawRadians);
    const cosPitch = Math.cos(view.pitchRadians), sinPitch = Math.sin(view.pitchRadians);
    const rotated = new Float32Array(vertexCount * COMPONENTS_PER_POSITION);
    for (let index = 0; index < vertexCount; index++) {
        const offset = index * COMPONENTS_PER_POSITION;
        const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
        const yawX = x * cosYaw + z * sinYaw;
        const yawZ = -x * sinYaw + z * cosYaw;
        rotated[offset] = yawX;
        rotated[offset + 1] = y * cosPitch - yawZ * sinPitch;
        rotated[offset + 2] = y * sinPitch + yawZ * cosPitch;
    }
    return rotated;
}

function edge(a: ViewPoint, b: ViewPoint, x: number, y: number): number {
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
}

function faceShade(rotated: Float32Array, ia: number, ib: number, ic: number): number {
    const ax = rotated[ia], ay = rotated[ia + 1], az = rotated[ia + 2];
    const abx = rotated[ib] - ax, aby = rotated[ib + 1] - ay, abz = rotated[ib + 2] - az;
    const acx = rotated[ic] - ax, acy = rotated[ic + 1] - ay, acz = rotated[ic + 2] - az;
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) return AMBIENT_LIGHT;
    const facing = Math.abs((nx * LIGHT_DIRECTION[0] + ny * LIGHT_DIRECTION[1] + nz * LIGHT_DIRECTION[2]) / length);
    return AMBIENT_LIGHT + DIFFUSE_LIGHT * facing;
}

function silhouetteFrame(rotated: Float32Array, vertexCount: number, size: number): ViewFrame {
    let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < vertexCount; index++) {
        const x = rotated[index * COMPONENTS_PER_POSITION], y = rotated[index * COMPONENTS_PER_POSITION + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const scale = size * (1 - 2 * FIT_MARGIN_FRACTION) / Math.max(maxX - minX, maxY - minY, Number.EPSILON);
    return {left: minX, top: maxY, offsetX: (size - (maxX - minX) * scale) / 2, offsetY: (size - (maxY - minY) * scale) / 2, scale};
}

function sphereFrame(positions: Float32Array, vertexCount: number, view: MeshView, size: number): ViewFrame {
    let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < vertexCount; index++) {
        const offset = index * COMPONENTS_PER_POSITION;
        const x = positions[offset], y = positions[offset + 1], z = positions[offset + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    const centre = new Float32Array([(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]);
    let radius = 0;
    for (let index = 0; index < vertexCount; index++) {
        const offset = index * COMPONENTS_PER_POSITION;
        radius = Math.max(radius, Math.hypot(positions[offset] - centre[0], positions[offset + 1] - centre[1], positions[offset + 2] - centre[2]));
    }
    const rotatedCentre = rotatedPositions(centre, 1, view);
    const scale = size * (1 - 2 * FIT_MARGIN_FRACTION) / Math.max(2 * radius, Number.EPSILON);
    return {left: rotatedCentre[0], top: rotatedCentre[1], offsetX: size / 2, offsetY: size / 2, scale};
}

export function renderMeshThumbnail(positions: Float32Array, cornerIndices: Float32Array, size: number, view: MeshView = DEFAULT_MESH_VIEW, fit: MeshFit = "silhouette"): DecodedImage {
    const vertexCount = Math.floor(positions.length / COMPONENTS_PER_POSITION);
    const triangleCount = Math.floor(cornerIndices.length / CORNERS_PER_TRIANGLE);
    const rgba = new Uint8Array(size * size * RGBA_CHANNELS);
    if (vertexCount === 0 || triangleCount === 0) return {width: size, height: size, rgba};
    const rotated = rotatedPositions(positions, vertexCount, view);
    const frame = fit === "sphere" ? sphereFrame(positions, vertexCount, view, size) : silhouetteFrame(rotated, vertexCount, size);
    const pointOf = (vertex: number): ViewPoint => {
        const offset = vertex * COMPONENTS_PER_POSITION;
        return {x: frame.offsetX + (rotated[offset] - frame.left) * frame.scale, y: frame.offsetY + (frame.top - rotated[offset + 1]) * frame.scale, depth: rotated[offset + 2]};
    };
    const depths = new Float32Array(size * size).fill(NO_DEPTH);
    const stride = Math.max(1, Math.ceil(triangleCount / MAX_MESH_THUMBNAIL_TRIANGLES));
    for (let triangle = 0; triangle < triangleCount; triangle += stride) {
        const corner = triangle * CORNERS_PER_TRIANGLE;
        const ia = cornerIndices[corner] | 0, ib = cornerIndices[corner + 1] | 0, ic = cornerIndices[corner + 2] | 0;
        if (ia >= vertexCount || ib >= vertexCount || ic >= vertexCount) continue;
        const a = pointOf(ia), b = pointOf(ib), c = pointOf(ic);
        const area = edge(a, b, c.x, c.y);
        if (area === 0) continue;
        const shade = faceShade(rotated, ia * COMPONENTS_PER_POSITION, ib * COMPONENTS_PER_POSITION, ic * COMPONENTS_PER_POSITION);
        const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
        const right = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
        const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
        const bottom = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
        for (let y = top; y <= bottom; y++) {
            const sampleY = y + PIXEL_CENTER;
            for (let x = left; x <= right; x++) {
                const sampleX = x + PIXEL_CENTER;
                const wa = edge(b, c, sampleX, sampleY) / area;
                const wb = edge(c, a, sampleX, sampleY) / area;
                const wc = 1 - wa - wb;
                if (wa < 0 || wb < 0 || wc < 0) continue;
                const depth = wa * a.depth + wb * b.depth + wc * c.depth;
                const pixel = y * size + x;
                if (depth <= depths[pixel]) continue;
                depths[pixel] = depth;
                const offset = pixel * RGBA_CHANNELS;
                rgba[offset] = Math.round(MESH_BASE_RGB[0] * shade);
                rgba[offset + 1] = Math.round(MESH_BASE_RGB[1] * shade);
                rgba[offset + 2] = Math.round(MESH_BASE_RGB[2] * shade);
                rgba[offset + 3] = OPAQUE;
            }
        }
    }
    return {width: size, height: size, rgba};
}

export function parseObjBytes(bytes: Uint8Array): Mesh {
    return Mesh.parseObj(new TextDecoder("utf-8", TEXT_DECODER_OPTIONS).decode(bytes));
}

function tooLargeReason(limitBytes: number): string {
    return `Larger than ${Math.round(limitBytes / BYTES_PER_MEGABYTE)} MB, so no thumbnail`;
}

export async function makeThumbnail(entry: ProjectEntry, read: (path: string) => Promise<Uint8Array>): Promise<Thumbnail> {
    const kind = projectFileKind(entry.path);
    if (isImageKind(kind)) {
        if (entry.size > MAX_IMAGE_THUMBNAIL_BYTES) return {kind: "icon", reason: tooLargeReason(MAX_IMAGE_THUMBNAIL_BYTES)};
        const decoded = decodeProjectImage(entry.path, await read(entry.path));
        return decoded === undefined ? {kind: "icon", reason: NOT_PREVIEWED_REASON} : {kind: "image", image: downscaledImage(decoded, THUMBNAIL_SIZE_PX)};
    }
    if (kind === "mesh") {
        if (entry.size > MAX_MESH_THUMBNAIL_BYTES) return {kind: "icon", reason: tooLargeReason(MAX_MESH_THUMBNAIL_BYTES)};
        const mesh = parseObjBytes(await read(entry.path));
        if (mesh.triangleCount === 0) return {kind: "icon", reason: EMPTY_MESH_REASON};
        return {kind: "image", image: renderMeshThumbnail(mesh.vertices.raw, mesh.triangles.raw, THUMBNAIL_SIZE_PX)};
    }
    return {kind: "icon", reason: NOT_PREVIEWED_REASON};
}
