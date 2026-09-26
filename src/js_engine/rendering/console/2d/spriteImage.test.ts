import {describe, expect, test} from "../../../testing/harness";
import {SpriteImage} from "./spriteImage";

describe("SpriteImage", () => {
    test("instances are frozen", () => {
        const image = SpriteImage.solid(1, 1, 0xFF0000);
        expect(Object.isFrozen(image)).toBe(true);
    });

    test("fromPixels copies the caller's buffer", () => {
        const rgba = new Uint8Array([1, 2, 3, 255]);
        const image = SpriteImage.fromPixels(1, 1, rgba);
        rgba[0] = 99;
        expect(image.rgba[0]).toBe(1);
    });

    test("fromPixels validates the byte count", () => {
        expect(() => SpriteImage.fromPixels(2, 2, new Uint8Array(4))).toThrow();
    });

    test("solid fills every pixel with the color at full alpha", () => {
        const image = SpriteImage.solid(2, 1, 0x336699);
        expect(image.sizeX).toBe(2);
        expect(image.sizeY).toBe(1);
        expect([...image.rgba]).toEqual([0x33, 0x66, 0x99, 255, 0x33, 0x66, 0x99, 255]);
    });

    test("fromPattern maps characters through the palette, unknowns transparent, short rows padded", () => {
        const image = SpriteImage.fromPattern(["#.", "#"], {"#": 0xFF0000});
        expect(image.sizeX).toBe(2);
        expect(image.sizeY).toBe(2);
        expect(image.rgba[3]).toBe(255);  // '#'
        expect(image.rgba[7]).toBe(0);    // '.' not in palette
        expect(image.rgba[11]).toBe(255); // '#'
        expect(image.rgba[15]).toBe(0);   // padded past the short row
    });

    test("fromFile decodes once per path and returns the cached instance", () => {
        const path = "./demo/3d/checker.png";
        const first = SpriteImage.fromFile(path);
        const second = SpriteImage.fromFile(path);
        expect(first === second).toBe(true);
        expect(first.sizeX > 0).toBe(true);
        expect(first.rgba.length).toBe(first.sizeX * first.sizeY * 4);
    });
});
