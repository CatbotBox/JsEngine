export interface PngIconImage {
    readonly sizePx: number;
    readonly png: Uint8Array;
}

export const ICO_HEADER_BYTES = 6;
export const ICO_TYPE_OFFSET = 2;
export const ICO_COUNT_OFFSET = 4;
export const ICO_TYPE_ICON = 1;
export const ICO_DIRECTORY_ENTRY_BYTES = 16;
export const ICO_ENTRY_WIDTH_OFFSET = 0;
export const ICO_ENTRY_HEIGHT_OFFSET = 1;
export const ICO_ENTRY_PALETTE_OFFSET = 2;
export const ICO_ENTRY_RESERVED_OFFSET = 3;
export const ICO_ENTRY_PLANES_OFFSET = 4;
export const ICO_ENTRY_BITS_PER_PIXEL_OFFSET = 6;
export const ICO_ENTRY_BYTES_OFFSET = 8;
export const ICO_ENTRY_IMAGE_OFFSET_OFFSET = 12;
export const ICO_MAX_DIMENSION_PX = 256;
export const ICO_DIMENSION_BYTE_FOR_MAX = 0;
export const ICO_COLOR_PLANES = 1;
export const ICO_BITS_PER_PIXEL = 32;
const ICO_RESERVED_OFFSET = 0;
const ICO_RESERVED = 0;
const ICO_NO_PALETTE = 0;

export const ICNS_MAGIC = "icns";
export const ICNS_HEADER_BYTES = 8;
export const ICNS_LENGTH_OFFSET = 4;
export const ICNS_ENTRY_HEADER_BYTES = 8;
export const ICNS_ENTRY_LENGTH_OFFSET = 4;
export const ICNS_PNG_TYPES_BY_SIZE_PX: ReadonlyMap<number, string> = new Map([
    [128, "ic07"],
    [256, "ic08"],
    [512, "ic09"],
    [1024, "ic10"],
]);
const OSTYPE_BYTES = 4;
const LITTLE_ENDIAN = true;

function totalBytes(images: readonly PngIconImage[]): number {
    return images.reduce((sum, image) => sum + image.png.length, 0);
}

export function encodeIco(images: readonly PngIconImage[]): Uint8Array {
    const directoryEnd = ICO_HEADER_BYTES + images.length * ICO_DIRECTORY_ENTRY_BYTES;
    const file = new Uint8Array(directoryEnd + totalBytes(images));
    const view = new DataView(file.buffer);
    view.setUint16(ICO_RESERVED_OFFSET, ICO_RESERVED, LITTLE_ENDIAN);
    view.setUint16(ICO_TYPE_OFFSET, ICO_TYPE_ICON, LITTLE_ENDIAN);
    view.setUint16(ICO_COUNT_OFFSET, images.length, LITTLE_ENDIAN);
    let imageOffset = directoryEnd;
    images.forEach((image, index) => {
        if (image.sizePx < 1 || image.sizePx > ICO_MAX_DIMENSION_PX) {
            throw new Error(`ico: ${image.sizePx} px does not fit an ICO entry (1-${ICO_MAX_DIMENSION_PX} px)`);
        }
        const entry = ICO_HEADER_BYTES + index * ICO_DIRECTORY_ENTRY_BYTES;
        const dimensionByte = image.sizePx === ICO_MAX_DIMENSION_PX ? ICO_DIMENSION_BYTE_FOR_MAX : image.sizePx;
        view.setUint8(entry + ICO_ENTRY_WIDTH_OFFSET, dimensionByte);
        view.setUint8(entry + ICO_ENTRY_HEIGHT_OFFSET, dimensionByte);
        view.setUint8(entry + ICO_ENTRY_PALETTE_OFFSET, ICO_NO_PALETTE);
        view.setUint8(entry + ICO_ENTRY_RESERVED_OFFSET, ICO_RESERVED);
        view.setUint16(entry + ICO_ENTRY_PLANES_OFFSET, ICO_COLOR_PLANES, LITTLE_ENDIAN);
        view.setUint16(entry + ICO_ENTRY_BITS_PER_PIXEL_OFFSET, ICO_BITS_PER_PIXEL, LITTLE_ENDIAN);
        view.setUint32(entry + ICO_ENTRY_BYTES_OFFSET, image.png.length, LITTLE_ENDIAN);
        view.setUint32(entry + ICO_ENTRY_IMAGE_OFFSET_OFFSET, imageOffset, LITTLE_ENDIAN);
        file.set(image.png, imageOffset);
        imageOffset += image.png.length;
    });
    return file;
}

function writeOsType(file: Uint8Array, offset: number, osType: string): void {
    if (osType.length !== OSTYPE_BYTES) throw new Error(`icns: "${osType}" is not a four-character type`);
    for (let i = 0; i < OSTYPE_BYTES; i++) file[offset + i] = osType.charCodeAt(i);
}

export function encodeIcns(images: readonly PngIconImage[]): Uint8Array {
    const file = new Uint8Array(ICNS_HEADER_BYTES + images.length * ICNS_ENTRY_HEADER_BYTES + totalBytes(images));
    const view = new DataView(file.buffer);
    writeOsType(file, 0, ICNS_MAGIC);
    view.setUint32(ICNS_LENGTH_OFFSET, file.length);
    let offset = ICNS_HEADER_BYTES;
    for (const image of images) {
        const osType = ICNS_PNG_TYPES_BY_SIZE_PX.get(image.sizePx);
        if (osType === undefined) {
            throw new Error(`icns: no PNG entry type for ${image.sizePx} px, expected one of ${[...ICNS_PNG_TYPES_BY_SIZE_PX.keys()].join(", ")}`);
        }
        writeOsType(file, offset, osType);
        view.setUint32(offset + ICNS_ENTRY_LENGTH_OFFSET, ICNS_ENTRY_HEADER_BYTES + image.png.length);
        file.set(image.png, offset + ICNS_ENTRY_HEADER_BYTES);
        offset += ICNS_ENTRY_HEADER_BYTES + image.png.length;
    }
    return file;
}
