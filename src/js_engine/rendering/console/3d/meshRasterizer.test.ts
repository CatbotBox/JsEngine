import {describe, expect, test} from "../../../testing/harness";
import {Vec} from "../../../math/types/vec";
import {Mesh, MeshBuilder} from "../../3d/mesh";
import {Material} from "../../3d/material";
import {Texture} from "../../3d/texture";
import {ScreenBuffer} from "../consoleScreenBuffer";
import {ScreenSize} from "../../screenSize";
import {MeshRasterizer, MeshRasterizerConfig} from "./meshRasterizer";
import {TextureStore} from "./textureStore";

const WIDTH = 8, HEIGHT = 8;

function config(overrides: Partial<MeshRasterizerConfig> = {}): MeshRasterizerConfig {
    return {
        maxDepthFade: 1000, colorQuantMask: 0xFFFFFF, supersample: 1, workerCount: 0,
        threadTriangleThreshold: Number.MAX_SAFE_INTEGER, threadAreaThreshold: Number.POSITIVE_INFINITY, textures: true,
        ...overrides,
    };
}

const identityModelView = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** A quad in view space at z = 1 that exactly covers the screen under orthographic projection (cellRatio 1). */
function screenQuad(material: Material): Mesh {
    const builder = new MeshBuilder();
    const hw = WIDTH / 2, hh = HEIGHT / 2;
    builder.vertices.push(Vec.alloc3(-hw, -hh, 1), Vec.alloc3(hw, -hh, 1), Vec.alloc3(hw, hh, 1), Vec.alloc3(-hw, hh, 1));
    builder.uvs.push(Vec.alloc2(0, 0), Vec.alloc2(1, 0), Vec.alloc2(1, 1), Vec.alloc2(0, 1));
    builder.triangles.push(Vec.alloc3(0, 2, 1), Vec.alloc3(0, 3, 2));
    builder.materials.push(material);
    builder.vertexMaterial.push(0, 0, 0, 0);
    builder.generateNormals();
    return new Mesh(builder);
}

function rgbaOf(colors: number[][]): Uint8Array {
    const out = new Uint8Array(colors.length * 4);
    colors.forEach(([r, g, b, a], i) => out.set([r, g, b, a ?? 255], i * 4));
    return out;
}

function render(mesh: Mesh, overrides: Partial<MeshRasterizerConfig> = {}): ScreenBuffer {
    const screenSize = new ScreenSize();
    screenSize.x = WIDTH;
    screenSize.y = HEIGHT;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, " ");
    const rasterizer = new MeshRasterizer();
    rasterizer.beginFrame(buffer, WIDTH, HEIGHT, config(overrides));
    rasterizer.addMesh(mesh, identityModelView, undefined, 1, 0xFFFFFF);
    rasterizer.endFrame();
    rasterizer.dispose();
    return buffer;
}

describe("MeshRasterizer textures", () => {
    const twoByTwo = Texture.fromRgba(2, 2, rgbaOf([[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]));

    test("an untextured quad fills the screen with its material color", () => {
        const buffer = render(screenQuad(new Material("flat", 0x336699)));
        expect(buffer.rgbAt(0, 0)).toBe(0x336699);
        expect(buffer.rgbAt(WIDTH - 1, HEIGHT - 1)).toBe(0x336699);
    });

    test("uv (0,1) is the top-left texel and uv (0,0) the bottom-left, matching obj convention", () => {
        const material = new Material("checker", 0xFFFFFF);
        material.diffuseTexture = twoByTwo;
        const buffer = render(screenQuad(material));
        expect(buffer.rgbAt(1, 1)).toBe(0xFF0000);
        expect(buffer.rgbAt(WIDTH - 2, 1)).toBe(0x00FF00);
        expect(buffer.rgbAt(1, HEIGHT - 2)).toBe(0x0000FF);
        expect(buffer.rgbAt(WIDTH - 2, HEIGHT - 2)).toBe(0xFFFFFF);
    });

    test("the texel is modulated by the material color", () => {
        const material = new Material("tinted", 0x808080);
        material.diffuseTexture = twoByTwo;
        const buffer = render(screenQuad(material));
        expect(buffer.rgbAt(WIDTH - 2, 1)).toBe(0x008000);
        expect(buffer.rgbAt(WIDTH - 2, HEIGHT - 2)).toBe(0x808080);
    });

    test("texels with alpha below 128 are cut out and leave the background", () => {
        const material = new Material("cutout", 0xFFFFFF);
        material.diffuseTexture = Texture.fromRgba(2, 2, rgbaOf([[255, 0, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255, 127]]));
        const buffer = render(screenQuad(material));
        expect(buffer.rgbAt(1, 1)).toBeUndefined();
        expect(buffer.rgbAt(WIDTH - 2, HEIGHT - 2)).toBeUndefined();
        expect(buffer.rgbAt(1, HEIGHT - 2)).toBe(0x0000FF);
    });

    test("textures can be switched off in the config", () => {
        const material = new Material("checker", 0xABCDEF);
        material.diffuseTexture = twoByTwo;
        const buffer = render(screenQuad(material), {textures: false});
        expect(buffer.rgbAt(1, 1)).toBe(0xABCDEF);
    });

    test("supersampling still samples the texture per subsample", () => {
        const material = new Material("checker", 0xFFFFFF);
        material.diffuseTexture = Texture.fromRgba(2, 2, rgbaOf([[255, 255, 255], [0, 0, 0], [0, 0, 0], [255, 255, 255]]));
        const buffer = render(screenQuad(material), {supersample: 2});
        expect(buffer.rgbAt(1, 1)).toBe(0xFFFFFF);
        expect(buffer.rgbAt(WIDTH - 2, 1)).toBe(0x000000);
        expect(buffer.rgbAt(1, HEIGHT - 2)).toBe(0x000000);
    });
});

/** A quad covering the given screen rect (cells) at z = 1 under orthographic projection. */
function screenRectQuad(material: Material, x0: number, y0: number, x1: number, y1: number): Mesh {
    const builder = new MeshBuilder();
    const hw = WIDTH / 2, hh = HEIGHT / 2;
    const toView = (x: number, y: number) => Vec.alloc3(x - hw, hh - y, 1);
    builder.vertices.push(toView(x0, y1), toView(x1, y1), toView(x1, y0), toView(x0, y0));
    builder.uvs.push(Vec.alloc2(0, 0), Vec.alloc2(1, 0), Vec.alloc2(1, 1), Vec.alloc2(0, 1));
    builder.triangles.push(Vec.alloc3(0, 2, 1), Vec.alloc3(0, 3, 2));
    builder.materials.push(material);
    builder.vertexMaterial.push(0, 0, 0, 0);
    builder.generateNormals();
    return new Mesh(builder);
}

describe("MeshRasterizer supersampling", () => {
    const red = new Material("red", 0xFF0000);

    test("a cell half covered horizontally blends toward black by default", () => {
        const buffer = render(screenRectQuad(red, 0, 0, 4.5, HEIGHT), {supersample: 2});
        expect(buffer.rgbAt(3, 1)).toBe(0xFF0000);
        expect(buffer.rgbAt(4, 1)).toBe(0x800000);
        expect(buffer.rgbAt(5, 1)).toBeUndefined();
    });

    test("uncovered subsamples take the configured background color", () => {
        const buffer = render(screenRectQuad(red, 0, 0, 4.5, HEIGHT), {supersample: 2, backgroundColor: 0x0000FF});
        expect(buffer.rgbAt(4, 1)).toBe(0x800080);
        expect(buffer.rgbAt(3, 1)).toBe(0xFF0000);
    });

    test("supersampleX and supersampleY act on their own axes", () => {
        const wide = render(screenRectQuad(red, 0, 0, WIDTH, 4.5), {supersample: 1, supersampleY: 4});
        expect(buffer(wide, 1, 3)).toBe(0xFF0000);
        expect(buffer(wide, 1, 4)).toBe(0x800000);
        expect(buffer(wide, 1, 5)).toBeUndefined();

        const tall = render(screenRectQuad(red, 0, 0, 4.25, HEIGHT), {supersample: 1, supersampleX: 4});
        expect(buffer(tall, 4, 1)).toBe(0x400000);
    });

    function buffer(screen: ScreenBuffer, x: number, y: number): number | undefined {
        return screen.rgbAt(x, y);
    }
});

describe("MeshRasterizer half-block cells", () => {
    const red = new Material("red", 0xFF0000);

    test("a quad ending mid-cell fills the top half and leaves the bottom half as background", () => {
        const screen = render(screenRectQuad(red, 0, 0, WIDTH, 4.5), {supersample: 1, halfBlock: true, backgroundColor: 0x0000FF});
        expect(screen.rgbAt(1, 3)).toBe(0xFF0000);
        expect(screen.splitRgbAt(1, 3)).toBeUndefined();
        expect(screen.splitRgbAt(1, 4)).toEqual([0xFF0000, undefined]);
        expect(screen.rgbAt(1, 5)).toBeUndefined();
        expect(screen.splitRgbAt(1, 5)).toBeUndefined();
    });

    test("each half still supersamples: a quarter-cell edge blends within the half", () => {
        const screen = render(screenRectQuad(red, 0, 0, WIDTH, 4.25), {supersample: 1, supersampleY: 2, halfBlock: true});
        expect(screen.splitRgbAt(1, 4)).toEqual([0x800000, undefined]);
    });

    test("half-block off reproduces whole-cell output", () => {
        const on = render(screenRectQuad(red, 0, 0, WIDTH, 4), {supersample: 1, halfBlock: true});
        const off = render(screenRectQuad(red, 0, 0, WIDTH, 4), {supersample: 1, halfBlock: false});
        for (let y = 0; y < HEIGHT; y++) {
            expect(on.rgbAt(1, y)).toBe(off.rgbAt(1, y));
        }
    });
});

describe("TextureStore", () => {
    test("uploads every level contiguously and describes them in the table", () => {
        const store = TextureStore.growable();
        const texture = Texture.fromRgba(4, 2, new Uint8Array(4 * 2 * 4).fill(255));
        const id = store.idOf(texture);
        expect(id).toBe(0);
        expect(store.idOf(texture)).toBe(0);
        expect(store.levelCountOf(id)).toBe(3);
        expect(store.baseTexelAreaOf(id)).toBe(8);
        expect(store.uploadedTexelCount).toBe(8 + 2 + 1);
        const descriptor = id * TextureStore.DESCRIPTOR_STRIDE;
        expect(Array.from(store.table.subarray(descriptor, descriptor + 1 + 3 * TextureStore.LEVEL_STRIDE))).toEqual([3, 0, 4, 2, 8, 2, 1, 10, 1, 1]);
    });

    test("a fixed-size store refuses textures it cannot fit", () => {
        const store = new TextureStore(new Int32Array(4), new Int32Array(TextureStore.DESCRIPTOR_STRIDE), false);
        const small = Texture.fromRgba(1, 1, new Uint8Array(4));
        const big = Texture.fromRgba(2, 2, new Uint8Array(16));
        expect(store.idOf(small)).toBe(0);
        expect(store.idOf(big)).toBe(TextureStore.NO_TEXTURE);
    });
});
