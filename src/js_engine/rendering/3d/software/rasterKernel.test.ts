import {describe, expect, test} from "../../../testing/harness";
import {rasterizeTriangleBand, TRI_STRIDE} from "./rasterKernel";

const WIDTH = 4, HEIGHT = 4;

function packTriangle(points: [number, number][], color = 0xFFFFFF): { floats: Float32Array, ints: Int32Array } {
    const floats = new Float32Array(TRI_STRIDE);
    const ints = new Int32Array(floats.buffer);
    for (let i = 0; i < 3; i++) {
        floats[i * 2] = points[i][0];
        floats[i * 2 + 1] = points[i][1];
        floats[6 + i] = 1;
        ints[9 + i] = color;
    }
    ints[18] = -1;
    return {floats, ints};
}

function rasterize(points: [number, number][]): { depth: Float32Array, color: Int32Array } {
    const {floats, ints} = packTriangle(points);
    const depth = new Float32Array(WIDTH * HEIGHT).fill(Number.POSITIVE_INFINITY);
    const color = new Int32Array(WIDTH * HEIGHT);
    rasterizeTriangleBand(floats, ints, 1, null, 0, 0, depth, color, new Int32Array(0), new Int32Array(0), WIDTH, 0, HEIGHT, 1000, 0xFFFFFF);
    return {depth, color};
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
