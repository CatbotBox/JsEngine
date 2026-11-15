import {describe, expect, test} from "../../engine/testing/harness";
import {Texture} from "../../engine/rendering/3d/texture";
import {GpuTextureCache, MATERIAL_TEXTURE_FORMAT, packTextureLevel} from "./gpuTextureCache";
import {FakeGpuDevice} from "./testing/fakeGpuDevice";

const TEXEL_WITH_HALF_ALPHA = (0x80 << 24) | 0x112233;
const OPAQUE_RED = (0xFF << 24) | 0xFF0000;
const RGBA_BYTES = 4;
const WIDTH = 8, HEIGHT = 4;
const EXPECTED_MIP_SIZES = [[8, 4], [4, 2], [2, 1], [1, 1]];

function solidTexture(width: number, height: number): Texture {
    const rgba = new Uint8Array(width * height * RGBA_BYTES).fill(0xFF);
    return Texture.fromRgba(width, height, rgba);
}

describe("packTextureLevel", () => {
    test("unpacks 0xAARRGGBB texels into R, G, B, A bytes", () => {
        const bytes = packTextureLevel({width: 2, height: 1, texels: new Int32Array([TEXEL_WITH_HALF_ALPHA, OPAQUE_RED])});
        expect(Array.from(bytes)).toEqual([0x11, 0x22, 0x33, 0x80, 0xFF, 0x00, 0x00, 0xFF]);
    });
});

describe("GpuTextureCache", () => {
    test("uploads every level of the texture's mip chain once, as rgba8unorm", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuTextureCache(device);
        const texture = solidTexture(WIDTH, HEIGHT);
        const view = cache.viewOf(texture);
        expect(cache.viewOf(texture)).toBe(view);
        expect(device.textures.length).toBe(1);
        const descriptor = device.textures[0].descriptor;
        expect([descriptor.format, descriptor.mipLevelCount, descriptor.size]).toEqual([MATERIAL_TEXTURE_FORMAT, texture.levels.length, {width: WIDTH, height: HEIGHT}]);
        expect(texture.levels.length).toBe(EXPECTED_MIP_SIZES.length);
        expect(device.queue.textureWrites.map(write => [write.destination.mipLevel, write.size])).toEqual(
            EXPECTED_MIP_SIZES.map(([width, height], level) => [level, {width, height}]));
        expect(device.queue.textureWrites.map(write => write.layout.bytesPerRow)).toEqual(EXPECTED_MIP_SIZES.map(([width]) => width * RGBA_BYTES));
    });

    test("no texture is a shared 1x1 opaque white one", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuTextureCache(device);
        expect(cache.viewOf(undefined)).toBe(cache.viewOf(undefined));
        expect(device.textures.length).toBe(1);
        expect(Array.from(device.queue.textureWrites[0].data as Uint8Array)).toEqual([0xFF, 0xFF, 0xFF, 0xFF]);
        expect(cache.size).toBe(0);
    });

    test("dispose destroys every uploaded texture, the white one included", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuTextureCache(device);
        cache.viewOf(solidTexture(WIDTH, HEIGHT));
        cache.viewOf(undefined);
        cache.dispose();
        expect(device.liveTextures().length).toBe(0);
        expect(cache.size).toBe(0);
    });
});
