import {describe, expect, test} from "../../../testing/harness";
import {rasterizeTriangleBand, TRI_STRIDE} from "./rasterKernel";

const WIDTH = 4, HEIGHT = 4;
const NO_TEXTURE = -1;
const NO_SPECULAR = 0;
const FAR_DEPTH_FADE = 1000;
const FULL_QUANT_MASK = 0xFFFFFF;
const OPAQUE_BLACK_TEXEL = 0xFF000000 | 0;
const TEXTURE_DESCRIPTOR_STRIDE = 49;
const SINGLE_TEXEL_LEVEL = [0, 1, 1];
const COVERING_TRIANGLE: [number, number][] = [[0, 0], [0, 4], [4, 0]];

interface TriangleOptions {
    readonly color?: number;
    readonly specular?: number;
    readonly textureId?: number;
}

function packTriangle(points: [number, number][], {color = 0xFFFFFF, specular = NO_SPECULAR, textureId = NO_TEXTURE}: TriangleOptions = {}): { floats: Float32Array, ints: Int32Array } {
    const floats = new Float32Array(TRI_STRIDE);
    const ints = new Int32Array(floats.buffer);
    for (let i = 0; i < 3; i++) {
        floats[i * 2] = points[i][0];
        floats[i * 2 + 1] = points[i][1];
        floats[6 + i] = 1;
        ints[9 + i] = color;
        ints[20 + i] = specular;
    }
    ints[18] = textureId;
    return {floats, ints};
}

function rasterize(points: [number, number][], options: TriangleOptions = {}, texels: Int32Array = new Int32Array(0), textureTable: Int32Array = new Int32Array(0)): { depth: Float32Array, color: Int32Array } {
    const {floats, ints} = packTriangle(points, options);
    const depth = new Float32Array(WIDTH * HEIGHT).fill(Number.POSITIVE_INFINITY);
    const color = new Int32Array(WIDTH * HEIGHT);
    rasterizeTriangleBand(floats, ints, 1, null, 0, 0, depth, color, texels, textureTable, WIDTH, 0, HEIGHT, FAR_DEPTH_FADE, FULL_QUANT_MASK);
    return {depth, color};
}

function singleTexelTexture(texel: number): { texels: Int32Array, table: Int32Array } {
    const table = new Int32Array(TEXTURE_DESCRIPTOR_STRIDE);
    table.set(SINGLE_TEXEL_LEVEL, 1);
    return {texels: new Int32Array([texel]), table};
}

describe("rasterizeTriangleBand sampling", () => {
    test("samples cell centers: a triangle around (0.5, 0.5) that misses the corner still draws cell (0,0)", () => {
        const {depth} = rasterize([[0.3, 0.3], [0.3, 1], [1, 0.3]]);
        expect(depth[0]).toBe(1);
        expect(depth[1]).toBe(Number.POSITIVE_INFINITY);
    });

    test("a triangle that only touches the corner of a cell does not draw it", () => {
        const {depth} = rasterize([[0, 0], [0, 0.4], [0.4, 0]]);
        expect(depth[0]).toBe(Number.POSITIVE_INFINITY);
    });

    test("only one winding is visible", () => {
        const visible = rasterize([[0, 0], [0, 4], [4, 0]]);
        const culled = rasterize([[0, 0], [4, 0], [0, 4]]);
        expect(visible.depth[0]).toBe(1);
        expect(culled.depth[0]).toBe(Number.POSITIVE_INFINITY);
    });
});

describe("rasterizeTriangleBand specular", () => {
    test("specular is added after the texel, so a black texel still shows the highlight", () => {
        const {texels, table} = singleTexelTexture(OPAQUE_BLACK_TEXEL);
        const highlight = 0x406080;
        const lit = rasterize(COVERING_TRIANGLE, {specular: highlight, textureId: 0}, texels, table);
        const unlit = rasterize(COVERING_TRIANGLE, {textureId: 0}, texels, table);
        expect(lit.color[0]).toBe(highlight);
        expect(unlit.color[0]).toBe(0);
    });

    test("specular is not tinted by the texel and saturates per channel", () => {
        const {texels, table} = singleTexelTexture(0xFFFF0000 | 0);
        const {color} = rasterize(COVERING_TRIANGLE, {specular: 0x202020, textureId: 0}, texels, table);
        expect(color[0]).toBe(0xFF2020);
    });

    test("untextured specular matches the summed and clamped vertex color", () => {
        for (const [diffuse, specular, summed] of [[0x102030, 0x010203, 0x112233], [0xF0F0F0, 0x404040, 0xFFFFFF], [0x80FF00, 0x80FF10, 0xFFFF10]]) {
            const split = rasterize(COVERING_TRIANGLE, {color: diffuse, specular});
            const combined = rasterize(COVERING_TRIANGLE, {color: summed});
            expect(Array.from(split.color)).toEqual(Array.from(combined.color));
        }
    });
});
