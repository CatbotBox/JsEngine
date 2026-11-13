import {describe, expect, test} from "../src/engine/testing/harness";
import {deflateStored} from "../src/engine/testing/storedDeflate";
import {decodePng, encodePng} from "../src/engine/assets/image/png";
import {inflate} from "../src/engine/assets/image/inflate";
import {
    encodeIcns,
    encodeIco,
    ICNS_ENTRY_HEADER_BYTES,
    ICNS_ENTRY_LENGTH_OFFSET,
    ICNS_HEADER_BYTES,
    ICNS_LENGTH_OFFSET,
    ICNS_MAGIC,
    ICO_BITS_PER_PIXEL,
    ICO_COLOR_PLANES,
    ICO_COUNT_OFFSET,
    ICO_DIMENSION_BYTE_FOR_MAX,
    ICO_DIRECTORY_ENTRY_BYTES,
    ICO_ENTRY_BITS_PER_PIXEL_OFFSET,
    ICO_ENTRY_BYTES_OFFSET,
    ICO_ENTRY_HEIGHT_OFFSET,
    ICO_ENTRY_IMAGE_OFFSET_OFFSET,
    ICO_ENTRY_PLANES_OFFSET,
    ICO_ENTRY_WIDTH_OFFSET,
    ICO_HEADER_BYTES,
    ICO_MAX_DIMENSION_PX,
    ICO_TYPE_ICON,
    ICO_TYPE_OFFSET,
} from "./iconFiles";
import type {PngIconImage} from "./iconFiles";

const RGBA_CHANNELS = 4;
const FILL_BYTE = 200;
const OSTYPE_BYTES = 4;
const LITTLE_ENDIAN = true;
const TOO_LARGE_FOR_ICO_PX = 512;
const NOT_AN_ICNS_SIZE_PX = 100;

function solidPng(sizePx: number): PngIconImage {
    const rgba = new Uint8Array(sizePx * sizePx * RGBA_CHANNELS).fill(FILL_BYTE);
    return {sizePx, png: encodePng(sizePx, sizePx, rgba, deflateStored)};
}

function osTypeAt(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(...bytes.subarray(offset, offset + OSTYPE_BYTES));
}

describe("ICO writer", () => {
    const images = [16, 32, ICO_MAX_DIMENSION_PX].map(solidPng);
    const ico = encodeIco(images);
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);

    test("the header declares an icon with one entry per image", () => {
        expect(view.getUint16(0, LITTLE_ENDIAN)).toBe(0);
        expect(view.getUint16(ICO_TYPE_OFFSET, LITTLE_ENDIAN)).toBe(ICO_TYPE_ICON);
        expect(view.getUint16(ICO_COUNT_OFFSET, LITTLE_ENDIAN)).toBe(images.length);
    });

    test("directory entries carry the size (0 for 256), planes, depth, byte count and the PNG's offset", () => {
        let expectedOffset = ICO_HEADER_BYTES + images.length * ICO_DIRECTORY_ENTRY_BYTES;
        images.forEach((image, index) => {
            const entry = ICO_HEADER_BYTES + index * ICO_DIRECTORY_ENTRY_BYTES;
            const dimensionByte = image.sizePx === ICO_MAX_DIMENSION_PX ? ICO_DIMENSION_BYTE_FOR_MAX : image.sizePx;
            expect(view.getUint8(entry + ICO_ENTRY_WIDTH_OFFSET)).toBe(dimensionByte);
            expect(view.getUint8(entry + ICO_ENTRY_HEIGHT_OFFSET)).toBe(dimensionByte);
            expect(view.getUint16(entry + ICO_ENTRY_PLANES_OFFSET, LITTLE_ENDIAN)).toBe(ICO_COLOR_PLANES);
            expect(view.getUint16(entry + ICO_ENTRY_BITS_PER_PIXEL_OFFSET, LITTLE_ENDIAN)).toBe(ICO_BITS_PER_PIXEL);
            expect(view.getUint32(entry + ICO_ENTRY_BYTES_OFFSET, LITTLE_ENDIAN)).toBe(image.png.length);
            expect(view.getUint32(entry + ICO_ENTRY_IMAGE_OFFSET_OFFSET, LITTLE_ENDIAN)).toBe(expectedOffset);
            expectedOffset += image.png.length;
        });
        expect(ico.length).toBe(expectedOffset);
    });

    test("each entry's bytes decode as the PNG of its size", () => {
        images.forEach((image, index) => {
            const entry = ICO_HEADER_BYTES + index * ICO_DIRECTORY_ENTRY_BYTES;
            const offset = view.getUint32(entry + ICO_ENTRY_IMAGE_OFFSET_OFFSET, LITTLE_ENDIAN);
            const length = view.getUint32(entry + ICO_ENTRY_BYTES_OFFSET, LITTLE_ENDIAN);
            const decoded = decodePng(ico.slice(offset, offset + length), {inflate});
            expect(decoded.width).toBe(image.sizePx);
            expect(decoded.height).toBe(image.sizePx);
        });
    });

    test("an image past 256 px is rejected", () => {
        expect(() => encodeIco([solidPng(TOO_LARGE_FOR_ICO_PX)])).toThrow("does not fit an ICO entry");
    });
});

describe("ICNS writer", () => {
    const images = [128, 256].map(solidPng);
    const icns = encodeIcns(images);
    const view = new DataView(icns.buffer, icns.byteOffset, icns.byteLength);

    test("the header is the magic and the big-endian total length", () => {
        expect(osTypeAt(icns, 0)).toBe(ICNS_MAGIC);
        expect(view.getUint32(ICNS_LENGTH_OFFSET)).toBe(icns.length);
    });

    test("entries are typed by size, their lengths include the entry header, and the PNG follows", () => {
        const first = ICNS_HEADER_BYTES;
        const second = first + ICNS_ENTRY_HEADER_BYTES + images[0].png.length;
        expect(osTypeAt(icns, first)).toBe("ic07");
        expect(view.getUint32(first + ICNS_ENTRY_LENGTH_OFFSET)).toBe(ICNS_ENTRY_HEADER_BYTES + images[0].png.length);
        expect([...icns.subarray(first + ICNS_ENTRY_HEADER_BYTES, second)]).toEqual([...images[0].png]);
        expect(osTypeAt(icns, second)).toBe("ic08");
        expect(view.getUint32(second + ICNS_ENTRY_LENGTH_OFFSET)).toBe(ICNS_ENTRY_HEADER_BYTES + images[1].png.length);
        expect(second + ICNS_ENTRY_HEADER_BYTES + images[1].png.length).toBe(icns.length);
    });

    test("a size without a PNG entry type is rejected", () => {
        expect(() => encodeIcns([solidPng(NOT_AN_ICNS_SIZE_PX)])).toThrow("no PNG entry type");
    });
});
