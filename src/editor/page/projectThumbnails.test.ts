import {describe, expect, test} from "../../engine/testing/harness";
import type {ProjectEntry} from "../project/projectFileSystem";
import {
    DEFAULT_MESH_VIEW,
    downscaledImage,
    hasThumbnail,
    makeThumbnail,
    MAX_IMAGE_THUMBNAIL_BYTES,
    MAX_MESH_THUMBNAIL_BYTES,
    parseObjBytes,
    renderMeshThumbnail,
    THUMBNAIL_SIZE_PX,
    ThumbnailCache,
    thumbnailKey,
} from "./projectThumbnails";

const RGBA_CHANNELS = 4;
const ALPHA_OFFSET = 3;
const PATTERN_FILE_TEXT = JSON.stringify({format: "jsengine-sprite-pattern", version: 1, rows: ["#.", "##"], palette: [{char: "#", rgb: "#00ff00"}]});
const GREEN_PIXEL = [0, 255, 0, 255];
const CLEAR_PIXEL = [0, 0, 0, 0];
const CUBE_OBJ = [
    "v -1 -1 -1", "v 1 -1 -1", "v 1 1 -1", "v -1 1 -1", "v -1 -1 1", "v 1 -1 1", "v 1 1 1", "v -1 1 1",
    "f 1 2 3 4", "f 5 8 7 6", "f 1 5 6 2", "f 2 6 7 3", "f 3 7 8 4", "f 5 1 4 8",
].join("\n");
const CUBE_THUMBNAIL_CHANNEL_SUM = 1_443_048;
const CUBE_THUMBNAIL_OPAQUE_PIXELS = 2290;
const ORBIT_PREVIEW_SIZE_PX = 128;

function entry(path: string, mtimeMs: number, size = 10): ProjectEntry {
    return {path, kind: "file", size, mtimeMs};
}

function ppm(width: number, height: number, rgb: readonly number[]): Uint8Array {
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const bytes = new Uint8Array(header.length + rgb.length);
    bytes.set(header);
    bytes.set(rgb, header.length);
    return bytes;
}

function channelSum(rgba: Uint8Array): number {
    let sum = 0;
    for (const channel of rgba) sum += channel;
    return sum;
}

function opaquePixels(rgba: Uint8Array): number {
    let count = 0;
    for (let offset = ALPHA_OFFSET; offset < rgba.length; offset += RGBA_CHANNELS) if (rgba[offset] > 0) count++;
    return count;
}

describe("thumbnail cache", () => {
    test("the key is the normalized path with its modification time and size", () => {
        expect(thumbnailKey(entry("./art\\ship.png", 12.5, 300))).toBe("art/ship.png@12.5:300");
        expect(thumbnailKey(entry("art/ship.png", 12.5, 300))).toBe(thumbnailKey(entry("art/ship.png", 12.5, 300)));
        expect(thumbnailKey(entry("art/ship.png", 13, 300))).not.toBe(thumbnailKey(entry("art/ship.png", 12.5, 300)));
    });

    test("a file is made once per modification time, and a newer version replaces the older one", async () => {
        const cache = new ThumbnailCache<string>();
        let made = 0;
        const make = (): Promise<string> => Promise.resolve(`made ${++made}`);
        expect(await cache.get(entry("a.png", 1), make)).toBe("made 1");
        expect(await cache.get(entry("a.png", 1), make)).toBe("made 1");
        expect(cache.peek(entry("a.png", 1))).toBe("made 1");
        expect(await cache.get(entry("a.png", 2), make)).toBe("made 2");
        expect(cache.has(entry("a.png", 1))).toBe(false);
        expect(cache.size).toBe(1);
    });

    test("peek answers only once the thumbnail is made, and a failed one is not kept", async () => {
        const cache = new ThumbnailCache<string>();
        let finish: (value: string) => void = () => undefined;
        const pending = cache.get(entry("a.png", 1), () => new Promise(resolve => finish = resolve));
        expect(cache.peek(entry("a.png", 1))).toBeUndefined();
        finish("ready");
        await pending;
        expect(cache.peek(entry("a.png", 1))).toBe("ready");
        await cache.get(entry("b.png", 1), () => Promise.reject(new Error("broken"))).catch(() => undefined);
        expect(cache.has(entry("b.png", 1))).toBe(false);
    });

    test("past its limit the least recently used thumbnail goes first", async () => {
        const cache = new ThumbnailCache<string>(2);
        const make = (): Promise<string> => Promise.resolve("x");
        await cache.get(entry("a.png", 1), make);
        await cache.get(entry("b.png", 1), make);
        await cache.get(entry("a.png", 1), make);
        await cache.get(entry("c.png", 1), make);
        expect([cache.has(entry("a.png", 1)), cache.has(entry("b.png", 1)), cache.has(entry("c.png", 1))]).toEqual([true, false, true]);
    });
});

describe("thumbnail images", () => {
    test("downscaling averages each block and keeps the aspect ratio", () => {
        const image = {width: 4, height: 2, rgba: new Uint8Array([
            0, 0, 0, 255, 255, 255, 255, 255, 10, 20, 30, 255, 10, 20, 30, 255,
            0, 0, 0, 255, 255, 255, 255, 255, 10, 20, 30, 255, 10, 20, 30, 255,
        ])};
        const small = downscaledImage(image, 2);
        expect([small.width, small.height]).toEqual([2, 1]);
        expect([...small.rgba]).toEqual([128, 128, 128, 255, 10, 20, 30, 255]);
        expect(downscaledImage(image, 8)).toBe(image);
    });

    test("a mesh renders as a shaded silhouette that fills the thumbnail's middle", () => {
        const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
        const rendered = renderMeshThumbnail(positions, new Float32Array([0, 1, 2]), THUMBNAIL_SIZE_PX);
        expect([rendered.width, rendered.height]).toEqual([THUMBNAIL_SIZE_PX, THUMBNAIL_SIZE_PX]);
        expect(opaquePixels(rendered.rgba)).toBeGreaterThan(0);
        const centre = (THUMBNAIL_SIZE_PX / 2 * THUMBNAIL_SIZE_PX + THUMBNAIL_SIZE_PX / 2) * RGBA_CHANNELS;
        expect(rendered.rgba[centre + ALPHA_OFFSET]).toBe(255);
        expect(rendered.rgba[ALPHA_OFFSET]).toBe(0);
        expect(opaquePixels(renderMeshThumbnail(new Float32Array(0), new Float32Array(0), THUMBNAIL_SIZE_PX).rgba)).toBe(0);
    });

    test("without a view a mesh renders from the fixed thumbnail angle it always used", () => {
        const cube = parseObjBytes(new TextEncoder().encode(CUBE_OBJ));
        const unviewed = renderMeshThumbnail(cube.vertices.raw, cube.triangles.raw, THUMBNAIL_SIZE_PX);
        expect([channelSum(unviewed.rgba), opaquePixels(unviewed.rgba)]).toEqual([CUBE_THUMBNAIL_CHANNEL_SUM, CUBE_THUMBNAIL_OPAQUE_PIXELS]);
        expect([...renderMeshThumbnail(cube.vertices.raw, cube.triangles.raw, THUMBNAIL_SIZE_PX, DEFAULT_MESH_VIEW).rgba]).toEqual([...unviewed.rgba]);
    });

    test("another yaw renders the mesh from another side", () => {
        const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, -1, 1]);
        const corners = new Float32Array([0, 1, 2, 0, 3, 2]);
        const front = renderMeshThumbnail(positions, corners, THUMBNAIL_SIZE_PX);
        const turned = renderMeshThumbnail(positions, corners, THUMBNAIL_SIZE_PX, {...DEFAULT_MESH_VIEW, yawRadians: DEFAULT_MESH_VIEW.yawRadians + Math.PI / 3});
        expect(turned.rgba.filter((channel, index) => channel !== front.rgba[index]).length).toBeGreaterThan(0);
    });

    test("fitting the bounding sphere keeps the scale steady while the mesh turns", () => {
        const cube = parseObjBytes(new TextEncoder().encode(CUBE_OBJ));
        const atYaw = (yawRadians: number): Uint8Array => renderMeshThumbnail(cube.vertices.raw, cube.triangles.raw, ORBIT_PREVIEW_SIZE_PX, {...DEFAULT_MESH_VIEW, yawRadians}, "sphere").rgba;
        expect([...atYaw(0)]).toEqual([...atYaw(Math.PI / 2)]);
        expect(opaquePixels(atYaw(Math.PI / 4))).toBeGreaterThan(opaquePixels(atYaw(0)));
    });

    test("images decode with the engine decoders and meshes parse as OBJ", async () => {
        const files = new Map<string, Uint8Array>([["red.ppm", ppm(2, 1, [255, 0, 0, 255, 0, 0])], ["cube.obj", new TextEncoder().encode(CUBE_OBJ)]]);
        const read = async (path: string): Promise<Uint8Array> => files.get(path)!;
        const image = await makeThumbnail(entry("red.ppm", 1, files.get("red.ppm")!.length), read);
        expect(image.kind === "image" ? [...image.image.rgba] : []).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
        const mesh = await makeThumbnail(entry("cube.obj", 1, files.get("cube.obj")!.length), read);
        expect(mesh.kind === "image" ? opaquePixels(mesh.image.rgba) > THUMBNAIL_SIZE_PX : false).toBe(true);
    });

    test("a sprite pattern file renders its decoded pattern like an image", async () => {
        const bytes = new TextEncoder().encode(PATTERN_FILE_TEXT);
        const thumbnail = await makeThumbnail(entry("art/ship.pattern.json", 1, bytes.length), async () => bytes);
        expect(thumbnail.kind === "image" ? [thumbnail.image.width, thumbnail.image.height] : []).toEqual([2, 2]);
        expect(thumbnail.kind === "image" ? [...thumbnail.image.rgba] : []).toEqual([...GREEN_PIXEL, ...CLEAR_PIXEL, ...GREEN_PIXEL, ...GREEN_PIXEL]);
        expect(hasThumbnail("art/ship.Pattern.Json")).toBe(true);
    });

    test("files too large to read, and other kinds, get the generic icon with a reason", async () => {
        const read = async (): Promise<Uint8Array> => {
            throw new Error("should not be read");
        };
        expect((await makeThumbnail(entry("big.png", 1, MAX_IMAGE_THUMBNAIL_BYTES + 1), read)).kind).toBe("icon");
        expect((await makeThumbnail(entry("big.obj", 1, MAX_MESH_THUMBNAIL_BYTES + 1), read)).kind).toBe("icon");
        expect((await makeThumbnail(entry("notes.txt", 1), read)).kind).toBe("icon");
        expect([hasThumbnail("a.JPG"), hasThumbnail("a.obj"), hasThumbnail("a.scene.json")]).toEqual([true, true, false]);
    });
});
