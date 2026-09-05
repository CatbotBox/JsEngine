import {describe, expect, test} from "../../testing/harness";
import {Texture} from "./texture";
import {Material, loadMaterialTextures} from "./material";
import {Mesh} from "./mesh";

function checkerRgba(width: number, height: number, checkSize = 1): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const light = ((Math.floor(x / checkSize) + Math.floor(y / checkSize)) & 1) === 0;
            const value = light ? 255 : 0;
            const i = (y * width + x) * 4;
            rgba[i] = rgba[i + 1] = rgba[i + 2] = value;
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

describe("Texture", () => {
    test("builds a mip chain down to 1x1 with box filtering", () => {
        const texture = Texture.fromRgba(4, 4, checkerRgba(4, 4));
        expect(texture.levels.map(l => [l.width, l.height])).toEqual([[4, 4], [2, 2], [1, 1]]);
        expect(texture.texelCount).toBe(16 + 4 + 1);
        expect((texture.levels[0].texels[0] >>> 0).toString(16)).toBe("ffffffff");
        expect((texture.levels[0].texels[1] >>> 0).toString(16)).toBe("ff000000");
        for (const texel of texture.levels[1].texels) expect((texel >>> 0).toString(16)).toBe("ff808080");
        expect((texture.levels[2].texels[0] >>> 0).toString(16)).toBe("ff808080");
    });

    test("averages alpha too and handles odd sizes", () => {
        const rgba = new Uint8Array(3 * 3 * 4).fill(255);
        rgba[3] = 0;
        const texture = Texture.fromRgba(3, 3, rgba);
        expect(texture.levels.map(l => [l.width, l.height])).toEqual([[3, 3], [1, 1]]);
        expect(texture.levels[1].texels[0] >>> 24).toBe(191);
    });

    test("downscales at load past maxDimension", () => {
        const texture = Texture.fromRgba(8, 4, checkerRgba(8, 4, 2), 4);
        expect(texture.width).toBe(4);
        expect(texture.height).toBe(2);
        expect(texture.levels.length).toBe(3);
    });

    test("sample uses nearest texel and wraps", () => {
        const texture = Texture.fromRgba(4, 4, checkerRgba(4, 4));
        expect(texture.sample(0, 0.1, 0.1) & 0xFFFFFF).toBe(0xFFFFFF);
        expect(texture.sample(0, 0.3, 0.1) & 0xFFFFFF).toBe(0x000000);
        expect(texture.sample(0, 1.1, -0.9) & 0xFFFFFF).toBe(0xFFFFFF);
        expect(texture.sample(5, 0.5, 0.5) & 0xFFFFFF).toBe(0x808080);
    });

    test("rejects empty images", () => {
        expect(() => Texture.fromRgba(0, 4, new Uint8Array(0))).toThrow("at least one texel");
    });
});

describe("loadMaterialTextures", () => {
    test("loads the checker texture referenced by the demo cube material", () => {
        const material = new Material("Material", 0xFFFFFF, "./demo/3d/checker.png");
        loadMaterialTextures([material]);
        expect(material.diffuseTexture).toBeDefined();
        expect(material.diffuseTexture!.width).toBe(64);
        expect(material.diffuseTexture!.levels.length).toBe(7);
    });

    test("shares one Texture between materials that name the same file", () => {
        const a = new Material("a", 0xFFFFFF, "./demo/3d/checker.png");
        const b = new Material("b", 0xFFFFFF, "./demo/3d/checker.png");
        loadMaterialTextures([a, b]);
        expect(a.diffuseTexture).toBe(b.diffuseTexture);
    });

    test("fills the specular slot too and shares the file with the diffuse slot", () => {
        const material = new Material("m", 0xFFFFFF, "./demo/3d/checker.png");
        material.specularTexturePath = "./demo/3d/checker.png";
        loadMaterialTextures([material]);
        expect(material.specularTexture).toBeDefined();
        expect(material.specularTexture).toBe(material.diffuseTexture);
    });

    test("a missing file leaves the material untextured instead of throwing", () => {
        const material = new Material("m", 0xFFFFFF, "./demo/3d/does-not-exist.png");
        loadMaterialTextures([material]);
        expect(material.diffuseTexture).toBeUndefined();
    });

    test("Mesh.fromFile wires cube.mtl and its texture", () => {
        const mesh = Mesh.fromFile("./demo/3d/cube.obj");
        expect(mesh.materials[0].diffuseTexture).toBeDefined();
        expect(mesh.materialOfTriangle(0).diffuseTexture!.height).toBe(64);
    });
});
