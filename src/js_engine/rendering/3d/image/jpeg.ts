import {DecodedImage, registerImageDecoder} from "./decodedImage";

const MARKER_PREFIX = 0xFF;
const MARKER_SOF0 = 0xC0;
const MARKER_SOF1 = 0xC1;
const MARKER_SOF2 = 0xC2;
const MARKER_DHT = 0xC4;
const MARKER_JPG = 0xC8;
const MARKER_DAC = 0xCC;
const MARKER_SOF15 = 0xCF;
const MARKER_RST0 = 0xD0;
const MARKER_RST7 = 0xD7;
const MARKER_SOI = 0xD8;
const MARKER_EOI = 0xD9;
const MARKER_SOS = 0xDA;
const MARKER_DQT = 0xDB;
const MARKER_DRI = 0xDD;
const MARKER_APP0 = 0xE0;
const MARKER_APP14 = 0xEE;

const BLOCK_SIZE = 8;
const BLOCK_AREA = 64;
const CONVERT_TO_PNG = "re-save it as a baseline JPEG or convert it to PNG";

/** Zigzag scan position -> natural (row-major) coefficient index. */
export const ZIGZAG_TO_NATURAL = new Uint8Array([
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

export function decodeJpeg(bytes: Uint8Array): DecodedImage {
    return new JpegDecoder(bytes).decode();
}

registerImageDecoder(".jpg", decodeJpeg);
registerImageDecoder(".jpeg", decodeJpeg);

interface FrameComponent {
    readonly id: number;
    readonly horizontalSampling: number;
    readonly verticalSampling: number;
    readonly quantTableId: number;
    readonly planeWidth: number;
    readonly plane: Uint8Array;
    dequantScale: Float32Array;
    dcTable: HuffmanTable;
    acTable: HuffmanTable;
    dcPredictor: number;
}

interface Frame {
    readonly width: number;
    readonly height: number;
    readonly components: FrameComponent[];
    readonly maxHorizontalSampling: number;
    readonly maxVerticalSampling: number;
    readonly mcusPerLine: number;
    readonly mcusPerColumn: number;
}

class JpegDecoder {
    private readonly quantTables: (Int32Array | undefined)[] = [];
    private readonly dcTables: (HuffmanTable | undefined)[] = [];
    private readonly acTables: (HuffmanTable | undefined)[] = [];
    private restartInterval = 0;
    private adobeTransform: number | undefined;
    private frame: Frame | undefined;
    private readonly coefficients = new Float32Array(BLOCK_AREA);

    public constructor(private readonly bytes: Uint8Array) {
    }

    public decode(): DecodedImage {
        const bytes = this.bytes;
        if (bytes[0] !== MARKER_PREFIX || bytes[1] !== MARKER_SOI) throw new Error("Not a JPEG file: missing SOI marker");
        let offset = 2;
        while (offset + 1 < bytes.length) {
            if (bytes[offset] !== MARKER_PREFIX) throw new Error(`JPEG is malformed: expected a marker at byte ${offset}`);
            const marker = bytes[offset + 1];
            offset += 2;
            if (marker === MARKER_PREFIX) {
                offset--;
                continue;
            }
            if (marker === MARKER_EOI) break;
            if (marker === MARKER_SOI || (marker >= MARKER_RST0 && marker <= MARKER_RST7)) continue;
            const length = readUint16(bytes, offset);
            const segment = bytes.subarray(offset + 2, offset + length);
            offset += length;
            if (marker === MARKER_DQT) this.readQuantTables(segment);
            else if (marker === MARKER_DHT) this.readHuffmanTables(segment);
            else if (marker === MARKER_SOF0 || marker === MARKER_SOF1) this.readFrame(segment);
            else if (marker === MARKER_SOF2) throw new Error(`Progressive JPEGs are not supported; ${CONVERT_TO_PNG}`);
            else if (isUnsupportedFrameMarker(marker)) throw new Error(`JPEG frame type 0x${marker.toString(16)} (lossless, hierarchical or arithmetic) is not supported; ${CONVERT_TO_PNG}`);
            else if (marker === MARKER_DRI) this.restartInterval = readUint16(segment, 0);
            else if (marker === MARKER_APP14) this.readAdobeSegment(segment);
            else if (marker === MARKER_SOS) offset = this.decodeScan(segment, offset);
        }
        if (this.frame === undefined) throw new Error("JPEG has no frame header");
        return this.toRgba(this.frame);
    }

    private readQuantTables(segment: Uint8Array): void {
        let offset = 0;
        while (offset < segment.length) {
            const precision = segment[offset] >> 4;
            const tableId = segment[offset] & 15;
            const table = new Int32Array(BLOCK_AREA);
            offset++;
            for (let k = 0; k < BLOCK_AREA; k++) {
                table[k] = precision === 0 ? segment[offset + k] : readUint16(segment, offset + k * 2);
            }
            offset += precision === 0 ? BLOCK_AREA : BLOCK_AREA * 2;
            this.quantTables[tableId] = table;
        }
    }

    private readHuffmanTables(segment: Uint8Array): void {
        let offset = 0;
        while (offset < segment.length) {
            const tableClass = segment[offset] >> 4;
            const tableId = segment[offset] & 15;
            const counts = segment.subarray(offset + 1, offset + 17);
            let total = 0;
            for (let i = 0; i < 16; i++) total += counts[i];
            const values = segment.subarray(offset + 17, offset + 17 + total);
            (tableClass === 0 ? this.dcTables : this.acTables)[tableId] = new HuffmanTable(counts, values);
            offset += 17 + total;
        }
    }

    private readFrame(segment: Uint8Array): void {
        const precision = segment[0];
        if (precision !== 8) throw new Error(`${precision}-bit JPEGs are not supported; ${CONVERT_TO_PNG}`);
        const height = readUint16(segment, 1);
        const width = readUint16(segment, 3);
        const componentCount = segment[5];
        if (height === 0) throw new Error("JPEGs with a deferred height (DNL) are not supported");
        if (width === 0 || componentCount === 0) throw new Error("JPEG frame header is malformed");
        let maxHorizontalSampling = 1, maxVerticalSampling = 1;
        const descriptors: { id: number, h: number, v: number, quantTableId: number }[] = [];
        for (let i = 0; i < componentCount; i++) {
            const base = 6 + i * 3;
            const h = segment[base + 1] >> 4, v = segment[base + 1] & 15;
            if (h < 1 || h > 4 || v < 1 || v > 4) throw new Error("JPEG sampling factors are out of range");
            descriptors.push({id: segment[base], h, v, quantTableId: segment[base + 2]});
            maxHorizontalSampling = Math.max(maxHorizontalSampling, h);
            maxVerticalSampling = Math.max(maxVerticalSampling, v);
        }
        const mcusPerLine = Math.ceil(width / (BLOCK_SIZE * maxHorizontalSampling));
        const mcusPerColumn = Math.ceil(height / (BLOCK_SIZE * maxVerticalSampling));
        const components = descriptors.map(descriptor => {
            const planeWidth = mcusPerLine * descriptor.h * BLOCK_SIZE;
            const planeHeight = mcusPerColumn * descriptor.v * BLOCK_SIZE;
            return {
                id: descriptor.id,
                horizontalSampling: descriptor.h,
                verticalSampling: descriptor.v,
                quantTableId: descriptor.quantTableId,
                planeWidth,
                plane: new Uint8Array(planeWidth * planeHeight),
                dequantScale: EMPTY_SCALE,
                dcTable: EMPTY_TABLE,
                acTable: EMPTY_TABLE,
                dcPredictor: 0,
            };
        });
        this.frame = {width, height, components, maxHorizontalSampling, maxVerticalSampling, mcusPerLine, mcusPerColumn};
    }

    private readAdobeSegment(segment: Uint8Array): void {
        const isAdobe = segment.length >= 12 && segment[0] === 0x41 && segment[1] === 0x64 && segment[2] === 0x6F && segment[3] === 0x62 && segment[4] === 0x65;
        if (isAdobe) this.adobeTransform = segment[11];
    }

    private decodeScan(segment: Uint8Array, dataOffset: number): number {
        const frame = this.frame;
        if (frame === undefined) throw new Error("JPEG scan appears before the frame header");
        const scanComponents: FrameComponent[] = [];
        const componentCount = segment[0];
        for (let i = 0; i < componentCount; i++) {
            const id = segment[1 + i * 2];
            const tableIds = segment[2 + i * 2];
            const component = frame.components.find(candidate => candidate.id === id);
            if (component === undefined) throw new Error(`JPEG scan references unknown component ${id}`);
            const dcTable = this.dcTables[tableIds >> 4];
            const acTable = this.acTables[tableIds & 15];
            const quantTable = this.quantTables[component.quantTableId];
            if (dcTable === undefined || acTable === undefined) throw new Error("JPEG scan references a Huffman table that was never defined");
            if (quantTable === undefined) throw new Error("JPEG scan references a quantization table that was never defined");
            component.dcTable = dcTable;
            component.acTable = acTable;
            component.dequantScale = aanDequantScale(quantTable);
            component.dcPredictor = 0;
            scanComponents.push(component);
        }
        const reader = new BitReader(this.bytes, dataOffset);
        if (scanComponents.length === 1) this.decodeNonInterleaved(reader, frame, scanComponents[0]);
        else this.decodeInterleaved(reader, frame, scanComponents);
        return reader.offsetOfNextMarker();
    }

    private decodeNonInterleaved(reader: BitReader, frame: Frame, component: FrameComponent): void {
        const componentWidth = Math.ceil(frame.width * component.horizontalSampling / frame.maxHorizontalSampling);
        const componentHeight = Math.ceil(frame.height * component.verticalSampling / frame.maxVerticalSampling);
        const blocksWide = Math.ceil(componentWidth / BLOCK_SIZE);
        const blocksHigh = Math.ceil(componentHeight / BLOCK_SIZE);
        const components = [component];
        let mcuIndex = 0;
        for (let blockY = 0; blockY < blocksHigh; blockY++) {
            for (let blockX = 0; blockX < blocksWide; blockX++) {
                this.restartIfDue(reader, mcuIndex++, components);
                this.decodeBlock(reader, component, blockX, blockY);
            }
        }
    }

    private decodeInterleaved(reader: BitReader, frame: Frame, components: FrameComponent[]): void {
        let mcuIndex = 0;
        for (let mcuY = 0; mcuY < frame.mcusPerColumn; mcuY++) {
            for (let mcuX = 0; mcuX < frame.mcusPerLine; mcuX++) {
                this.restartIfDue(reader, mcuIndex++, components);
                for (const component of components) {
                    for (let v = 0; v < component.verticalSampling; v++) {
                        for (let h = 0; h < component.horizontalSampling; h++) {
                            this.decodeBlock(reader, component, mcuX * component.horizontalSampling + h, mcuY * component.verticalSampling + v);
                        }
                    }
                }
            }
        }
    }

    private restartIfDue(reader: BitReader, mcuIndex: number, components: FrameComponent[]): void {
        if (this.restartInterval === 0 || mcuIndex === 0 || mcuIndex % this.restartInterval !== 0) return;
        reader.restart();
        for (const component of components) component.dcPredictor = 0;
    }

    private decodeBlock(reader: BitReader, component: FrameComponent, blockX: number, blockY: number): void {
        const coefficients = this.coefficients;
        const scale = component.dequantScale;
        const dcSize = component.dcTable.decode(reader);
        component.dcPredictor += dcSize === 0 ? 0 : reader.receiveExtend(dcSize);
        const dc = component.dcPredictor * scale[0];
        let hasAc = false;
        let k = 1;
        while (k < BLOCK_AREA) {
            const runSize = component.acTable.decode(reader);
            const size = runSize & 15;
            const run = runSize >> 4;
            if (size === 0) {
                if (run !== 15) break;
                k += 16;
                continue;
            }
            k += run;
            if (k > 63) throw new Error("JPEG block has more than 64 coefficients (corrupt scan)");
            if (!hasAc) {
                coefficients.fill(0);
                hasAc = true;
            }
            coefficients[ZIGZAG_TO_NATURAL[k]] = reader.receiveExtend(size) * scale[k];
            k++;
        }
        const planeOffset = blockY * BLOCK_SIZE * component.planeWidth + blockX * BLOCK_SIZE;
        if (hasAc) {
            coefficients[0] = dc;
            inverseDctBlock(coefficients, component.plane, planeOffset, component.planeWidth);
        } else {
            fillBlock(clampToByte(dc * 0.125 + 128.5), component.plane, planeOffset, component.planeWidth);
        }
    }

    private toRgba(frame: Frame): DecodedImage {
        const {width, height, components} = frame;
        const rgba = new Uint8Array(width * height * 4);
        const columnMaps = components.map(component => buildColumnMap(width, component.horizontalSampling, frame.maxHorizontalSampling));
        const rowOf = (component: FrameComponent, y: number) => Math.floor(y * component.verticalSampling / frame.maxVerticalSampling) * component.planeWidth;
        if (components.length === 1) {
            const [grey] = components;
            for (let y = 0, out = 0; y < height; y++) {
                const row = rowOf(grey, y);
                for (let x = 0; x < width; x++, out += 4) {
                    const value = grey.plane[row + columnMaps[0][x]];
                    rgba[out] = rgba[out + 1] = rgba[out + 2] = value;
                    rgba[out + 3] = 255;
                }
            }
        } else if (components.length === 3) {
            const [first, second, third] = components;
            const storedAsRgb = this.adobeTransform === 0 || (this.adobeTransform === undefined && first.id === 82 && second.id === 71 && third.id === 66);
            for (let y = 0, out = 0; y < height; y++) {
                const row0 = rowOf(first, y), row1 = rowOf(second, y), row2 = rowOf(third, y);
                for (let x = 0; x < width; x++, out += 4) {
                    const a = first.plane[row0 + columnMaps[0][x]];
                    const b = second.plane[row1 + columnMaps[1][x]];
                    const c = third.plane[row2 + columnMaps[2][x]];
                    if (storedAsRgb) {
                        rgba[out] = a;
                        rgba[out + 1] = b;
                        rgba[out + 2] = c;
                    } else {
                        const cb = b - 128, cr = c - 128;
                        rgba[out] = clampToByte(a + ((91881 * cr + 32768) >> 16));
                        rgba[out + 1] = clampToByte(a - ((22554 * cb + 46802 * cr + 32768) >> 16));
                        rgba[out + 2] = clampToByte(a + ((116130 * cb + 32768) >> 16));
                    }
                    rgba[out + 3] = 255;
                }
            }
        } else {
            throw new Error(`JPEGs with ${components.length} components (CMYK/YCCK) are not supported; ${CONVERT_TO_PNG}`);
        }
        return {width, height, rgba};
    }
}

class HuffmanTable {
    private readonly lookaheadLength = new Uint8Array(256);
    private readonly lookaheadValue = new Uint8Array(256);
    private readonly maxCode = new Int32Array(18);
    private readonly valueOffset = new Int32Array(17);
    private readonly values: Uint8Array;

    public constructor(counts: Uint8Array, values: Uint8Array) {
        this.values = values;
        let code = 0, k = 0;
        for (let length = 1; length <= 16; length++) {
            const count = counts[length - 1];
            if (count === 0) {
                this.maxCode[length] = -1;
            } else {
                this.valueOffset[length] = k - code;
                for (let i = 0; i < count; i++, code++, k++) {
                    if (length <= 8) {
                        const shift = 8 - length;
                        const base = code << shift;
                        for (let j = 0; j < 1 << shift; j++) {
                            this.lookaheadLength[base + j] = length;
                            this.lookaheadValue[base + j] = values[k];
                        }
                    }
                }
                this.maxCode[length] = code - 1;
            }
            if (code > 1 << length) throw new Error("JPEG Huffman table is over-subscribed");
            code <<= 1;
        }
        this.maxCode[17] = 0x7FFFFFFF;
    }

    public decode(reader: BitReader): number {
        const peek = reader.peekBits(8);
        const lookaheadLength = this.lookaheadLength[peek];
        if (lookaheadLength > 0) {
            reader.consume(lookaheadLength);
            return this.lookaheadValue[peek];
        }
        reader.consume(8);
        let code = peek;
        let length = 8;
        while (code > this.maxCode[length]) {
            code = (code << 1) | reader.readBit();
            length++;
            if (length > 16) throw new Error("JPEG scan contains an invalid Huffman code (corrupt data)");
        }
        return this.values[code + this.valueOffset[length]];
    }
}

class BitReader {
    private bitBuffer = 0;
    private bitCount = 0;
    private overrunBits = 0;
    private offset: number;

    public constructor(private readonly bytes: Uint8Array, offset: number) {
        this.offset = offset;
    }

    public peekBits(count: number): number {
        if (this.bitCount < count) this.fill();
        return (this.bitBuffer >>> (this.bitCount - count)) & ((1 << count) - 1);
    }

    public consume(count: number): void {
        this.bitCount -= count;
        if (this.bitCount < this.overrunBits) throw new Error("JPEG scan data is truncated");
    }

    public readBit(): number {
        const bit = this.peekBits(1);
        this.consume(1);
        return bit;
    }

    public readBits(count: number): number {
        const bits = this.peekBits(count);
        this.consume(count);
        return bits;
    }

    public receiveExtend(size: number): number {
        const bits = this.readBits(size);
        return bits < 1 << (size - 1) ? bits - (1 << size) + 1 : bits;
    }

    public restart(): void {
        this.bitBuffer = 0;
        this.bitCount = 0;
        this.overrunBits = 0;
        const marker = this.offsetOfNextMarker();
        const markerCode = this.bytes[marker + 1];
        this.offset = markerCode >= MARKER_RST0 && markerCode <= MARKER_RST7 ? marker + 2 : marker;
    }

    public offsetOfNextMarker(): number {
        const bytes = this.bytes;
        let offset = this.offset;
        while (offset + 1 < bytes.length) {
            if (bytes[offset] === MARKER_PREFIX && bytes[offset + 1] !== 0 && bytes[offset + 1] !== MARKER_PREFIX) return offset;
            offset++;
        }
        return bytes.length;
    }

    private fill(): void {
        const bytes = this.bytes;
        while (this.bitCount <= 24) {
            let byte = 0;
            if (this.offset >= bytes.length) {
                this.overrunBits += 8;
            } else if (bytes[this.offset] === MARKER_PREFIX) {
                const next = bytes[this.offset + 1];
                if (next === 0) {
                    byte = MARKER_PREFIX;
                    this.offset += 2;
                } else if (next === MARKER_PREFIX) {
                    this.offset++;
                    continue;
                }
            } else {
                byte = bytes[this.offset++];
            }
            this.bitBuffer = (this.bitBuffer << 8) | byte;
            this.bitCount += 8;
        }
    }
}

const EMPTY_SCALE = new Float32Array(BLOCK_AREA);
const EMPTY_TABLE = new HuffmanTable(new Uint8Array(16), new Uint8Array(0));

const AAN_SCALE = [1.0, 1.387039845, 1.306562965, 1.175875602, 1.0, 0.785694958, 0.541196100, 0.275899379];

const aanScaleByQuantTable = new WeakMap<Int32Array, Float32Array>();

function aanDequantScale(quantTable: Int32Array): Float32Array {
    let scale = aanScaleByQuantTable.get(quantTable);
    if (scale === undefined) {
        scale = new Float32Array(BLOCK_AREA);
        for (let k = 0; k < BLOCK_AREA; k++) {
            const natural = ZIGZAG_TO_NATURAL[k];
            scale[k] = quantTable[k] * AAN_SCALE[natural >> 3] * AAN_SCALE[natural & 7];
        }
        aanScaleByQuantTable.set(quantTable, scale);
    }
    return scale;
}

const idctWorkspace = new Float32Array(BLOCK_AREA);

function inverseDctBlock(input: Float32Array, plane: Uint8Array, planeOffset: number, planeWidth: number): void {
    const workspace = idctWorkspace;
    for (let column = 0; column < BLOCK_SIZE; column++) {
        inverseDct1d(input, column, BLOCK_SIZE, workspace, column, BLOCK_SIZE);
    }
    for (let row = 0; row < BLOCK_SIZE; row++) {
        inverseDct1d(workspace, row * BLOCK_SIZE, 1, input, row * BLOCK_SIZE, 1);
    }
    for (let row = 0; row < BLOCK_SIZE; row++) {
        const rowStart = planeOffset + row * planeWidth;
        const inputStart = row * BLOCK_SIZE;
        for (let column = 0; column < BLOCK_SIZE; column++) {
            plane[rowStart + column] = clampToByte(input[inputStart + column] * 0.125 + 128.5);
        }
    }
}

function inverseDct1d(input: Float32Array, inputStart: number, inputStride: number, output: Float32Array, outputStart: number, outputStride: number): void {
    const in0 = input[inputStart], in1 = input[inputStart + inputStride], in2 = input[inputStart + inputStride * 2], in3 = input[inputStart + inputStride * 3];
    const in4 = input[inputStart + inputStride * 4], in5 = input[inputStart + inputStride * 5], in6 = input[inputStart + inputStride * 6], in7 = input[inputStart + inputStride * 7];

    const even10 = in0 + in4;
    const even11 = in0 - in4;
    const even13 = in2 + in6;
    const even12 = (in2 - in6) * 1.414213562 - even13;
    const even0 = even10 + even13;
    const even3 = even10 - even13;
    const even1 = even11 + even12;
    const even2 = even11 - even12;

    const z13 = in5 + in3;
    const z10 = in5 - in3;
    const z11 = in1 + in7;
    const z12 = in1 - in7;
    const odd7 = z11 + z13;
    const odd11 = (z11 - z13) * 1.414213562;
    const z5 = (z10 + z12) * 1.847759065;
    const odd10 = 1.082392200 * z12 - z5;
    const odd12 = -2.613125930 * z10 + z5;
    const odd6 = odd12 - odd7;
    const odd5 = odd11 - odd6;
    const odd4 = odd10 + odd5;

    output[outputStart] = even0 + odd7;
    output[outputStart + outputStride * 7] = even0 - odd7;
    output[outputStart + outputStride] = even1 + odd6;
    output[outputStart + outputStride * 6] = even1 - odd6;
    output[outputStart + outputStride * 2] = even2 + odd5;
    output[outputStart + outputStride * 5] = even2 - odd5;
    output[outputStart + outputStride * 4] = even3 + odd4;
    output[outputStart + outputStride * 3] = even3 - odd4;
}

function fillBlock(value: number, plane: Uint8Array, planeOffset: number, planeWidth: number): void {
    for (let row = 0; row < BLOCK_SIZE; row++) {
        const rowStart = planeOffset + row * planeWidth;
        plane.fill(value, rowStart, rowStart + BLOCK_SIZE);
    }
}

function buildColumnMap(width: number, sampling: number, maxSampling: number): Int32Array {
    const map = new Int32Array(width);
    for (let x = 0; x < width; x++) map[x] = Math.floor(x * sampling / maxSampling);
    return map;
}

function isUnsupportedFrameMarker(marker: number): boolean {
    return marker >= MARKER_SOF0 && marker <= MARKER_SOF15 && marker !== MARKER_DHT && marker !== MARKER_JPG && marker !== MARKER_DAC;
}

function clampToByte(value: number): number {
    return value < 0 ? 0 : value > 255 ? 255 : value | 0;
}

function readUint16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

export interface JpegEncodeOptions {
    quality?: number;
    chromaSubsampling?: "4:4:4" | "4:2:0";
    restartInterval?: number;
    greyscale?: boolean;
}

export function encodeJpeg(width: number, height: number, rgba: Uint8Array, options: JpegEncodeOptions = {}): Uint8Array {
    return new JpegEncoder(width, height, rgba, options).encode();
}

interface EncoderComponent {
    readonly id: number;
    readonly sampling: number;
    readonly tableId: number;
    readonly plane: Float32Array;
    readonly planeWidth: number;
    dcPredictor: number;
}

class JpegEncoder {
    private readonly restartInterval: number;
    private readonly components: EncoderComponent[];
    private readonly mcusPerLine: number;
    private readonly mcusPerColumn: number;
    private readonly quantTables: Int32Array[];
    private readonly dcCodes: HuffmanCodes[];
    private readonly acCodes: HuffmanCodes[];
    private readonly writer = new BitWriter();
    private readonly block = new Float32Array(BLOCK_AREA);
    private readonly quantized = new Int32Array(BLOCK_AREA);

    public constructor(private readonly width: number, private readonly height: number, rgba: Uint8Array, options: JpegEncodeOptions) {
        const quality = options.quality ?? 90;
        this.restartInterval = options.restartInterval ?? 0;
        const lumaSampling = options.chromaSubsampling === "4:2:0" && !options.greyscale ? 2 : 1;
        this.mcusPerLine = Math.ceil(width / (BLOCK_SIZE * lumaSampling));
        this.mcusPerColumn = Math.ceil(height / (BLOCK_SIZE * lumaSampling));
        const ycc = toYCbCr(width, height, rgba);
        const descriptors = [{id: 1, sampling: lumaSampling, tableId: 0, channel: 0}];
        if (!options.greyscale) descriptors.push({id: 2, sampling: 1, tableId: 1, channel: 1}, {id: 3, sampling: 1, tableId: 1, channel: 2});
        this.components = descriptors.map(descriptor => {
            const planeWidth = this.mcusPerLine * descriptor.sampling * BLOCK_SIZE;
            const planeHeight = this.mcusPerColumn * descriptor.sampling * BLOCK_SIZE;
            return {
                id: descriptor.id,
                sampling: descriptor.sampling,
                tableId: descriptor.tableId,
                planeWidth,
                plane: buildComponentPlane(ycc, width, height, descriptor.channel, planeWidth, planeHeight, lumaSampling / descriptor.sampling),
                dcPredictor: 0,
            };
        });
        this.quantTables = [scaleQuantTable(STANDARD_LUMINANCE_QUANT, quality), scaleQuantTable(STANDARD_CHROMINANCE_QUANT, quality)];
        this.dcCodes = [buildHuffmanCodes(STANDARD_DC_LUMINANCE), buildHuffmanCodes(STANDARD_DC_CHROMINANCE)];
        this.acCodes = [buildHuffmanCodes(STANDARD_AC_LUMINANCE), buildHuffmanCodes(STANDARD_AC_CHROMINANCE)];
    }

    public encode(): Uint8Array {
        const writer = this.writer;
        const tableCount = this.components.length === 1 ? 1 : 2;
        writer.writeMarker(MARKER_SOI);
        writer.writeSegment(MARKER_APP0, [0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
        for (let id = 0; id < tableCount; id++) {
            const table = this.quantTables[id];
            const zigzag: number[] = [id];
            for (let k = 0; k < BLOCK_AREA; k++) zigzag.push(table[ZIGZAG_TO_NATURAL[k]]);
            writer.writeSegment(MARKER_DQT, zigzag);
        }
        const frameHeader = [8, this.height >> 8, this.height & 255, this.width >> 8, this.width & 255, this.components.length];
        for (const component of this.components) frameHeader.push(component.id, (component.sampling << 4) | component.sampling, component.tableId);
        writer.writeSegment(MARKER_SOF0, frameHeader);
        for (let id = 0; id < tableCount; id++) {
            const dc = id === 0 ? STANDARD_DC_LUMINANCE : STANDARD_DC_CHROMINANCE;
            const ac = id === 0 ? STANDARD_AC_LUMINANCE : STANDARD_AC_CHROMINANCE;
            writer.writeSegment(MARKER_DHT, [id, ...dc.counts, ...dc.values]);
            writer.writeSegment(MARKER_DHT, [0x10 | id, ...ac.counts, ...ac.values]);
        }
        if (this.restartInterval > 0) writer.writeSegment(MARKER_DRI, [this.restartInterval >> 8, this.restartInterval & 255]);
        const scanHeader = [this.components.length];
        for (const component of this.components) scanHeader.push(component.id, (component.tableId << 4) | component.tableId);
        scanHeader.push(0, 63, 0);
        writer.writeSegment(MARKER_SOS, scanHeader);
        this.encodeScan();
        writer.writeMarker(MARKER_EOI);
        return writer.toBytes();
    }

    private encodeScan(): void {
        let mcuIndex = 0;
        let restartCount = 0;
        for (let mcuY = 0; mcuY < this.mcusPerColumn; mcuY++) {
            for (let mcuX = 0; mcuX < this.mcusPerLine; mcuX++) {
                if (this.restartInterval > 0 && mcuIndex > 0 && mcuIndex % this.restartInterval === 0) {
                    this.writer.flushBits();
                    this.writer.writeMarker(MARKER_RST0 + (restartCount++ & 7));
                    for (const component of this.components) component.dcPredictor = 0;
                }
                for (const component of this.components) {
                    for (let v = 0; v < component.sampling; v++) {
                        for (let h = 0; h < component.sampling; h++) {
                            this.encodeBlock(component, mcuX * component.sampling + h, mcuY * component.sampling + v);
                        }
                    }
                }
                mcuIndex++;
            }
        }
        this.writer.flushBits();
    }

    private encodeBlock(component: EncoderComponent, blockX: number, blockY: number): void {
        const block = this.block;
        const quantized = this.quantized;
        const planeOffset = blockY * BLOCK_SIZE * component.planeWidth + blockX * BLOCK_SIZE;
        for (let row = 0; row < BLOCK_SIZE; row++) {
            for (let column = 0; column < BLOCK_SIZE; column++) {
                block[row * BLOCK_SIZE + column] = component.plane[planeOffset + row * component.planeWidth + column] - 128;
            }
        }
        forwardDctBlock(block);
        const quantTable = this.quantTables[component.tableId];
        for (let k = 0; k < BLOCK_AREA; k++) {
            const natural = ZIGZAG_TO_NATURAL[k];
            quantized[k] = Math.round(block[natural] / quantTable[natural]);
        }
        const dcCodes = this.dcCodes[component.tableId];
        const acCodes = this.acCodes[component.tableId];
        const diff = quantized[0] - component.dcPredictor;
        component.dcPredictor = quantized[0];
        this.writeCoefficient(dcCodes, 0, diff);
        let run = 0;
        for (let k = 1; k < BLOCK_AREA; k++) {
            const value = quantized[k];
            if (value === 0) {
                run++;
                continue;
            }
            while (run > 15) {
                this.writer.writeCode(acCodes, 0xF0);
                run -= 16;
            }
            this.writeCoefficient(acCodes, run, value);
            run = 0;
        }
        if (run > 0) this.writer.writeCode(acCodes, 0x00);
    }

    private writeCoefficient(codes: HuffmanCodes, run: number, value: number): void {
        const size = bitSizeOf(value);
        this.writer.writeCode(codes, (run << 4) | size);
        if (size > 0) this.writer.writeBits(value < 0 ? value + (1 << size) - 1 : value, size);
    }
}

interface HuffmanCodes {
    readonly code: Uint16Array;
    readonly length: Uint8Array;
}

interface StandardHuffmanTable {
    readonly counts: readonly number[];
    readonly values: readonly number[];
}

function buildHuffmanCodes(table: StandardHuffmanTable): HuffmanCodes {
    const code = new Uint16Array(256);
    const length = new Uint8Array(256);
    let current = 0, k = 0;
    for (let bits = 1; bits <= 16; bits++) {
        for (let i = 0; i < table.counts[bits - 1]; i++, k++, current++) {
            code[table.values[k]] = current;
            length[table.values[k]] = bits;
        }
        current <<= 1;
    }
    if (k !== table.values.length) throw new Error("Standard Huffman table counts do not match its values");
    return {code, length};
}

class BitWriter {
    private readonly bytes: number[] = [];
    private bitBuffer = 0;
    private bitCount = 0;

    public writeMarker(marker: number): void {
        this.bytes.push(MARKER_PREFIX, marker);
    }

    public writeSegment(marker: number, payload: number[]): void {
        const length = payload.length + 2;
        this.bytes.push(MARKER_PREFIX, marker, length >> 8, length & 255, ...payload);
    }

    public writeCode(codes: HuffmanCodes, symbol: number): void {
        const length = codes.length[symbol];
        if (length === 0) throw new Error(`Huffman table has no code for symbol 0x${symbol.toString(16)}`);
        this.writeBits(codes.code[symbol], length);
    }

    public writeBits(value: number, count: number): void {
        for (let bit = count - 1; bit >= 0; bit--) {
            this.bitBuffer = (this.bitBuffer << 1) | ((value >> bit) & 1);
            if (++this.bitCount === 8) this.emitByte();
        }
    }

    public flushBits(): void {
        while (this.bitCount !== 0) this.writeBits(1, 1);
    }

    public toBytes(): Uint8Array {
        return new Uint8Array(this.bytes);
    }

    private emitByte(): void {
        this.bytes.push(this.bitBuffer);
        if (this.bitBuffer === MARKER_PREFIX) this.bytes.push(0);
        this.bitBuffer = 0;
        this.bitCount = 0;
    }
}

function toYCbCr(width: number, height: number, rgba: Uint8Array): Float32Array {
    const ycc = new Float32Array(width * height * 3);
    for (let i = 0, input = 0, output = 0; i < width * height; i++, input += 4, output += 3) {
        const r = rgba[input], g = rgba[input + 1], b = rgba[input + 2];
        ycc[output] = 0.299 * r + 0.587 * g + 0.114 * b;
        ycc[output + 1] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        ycc[output + 2] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    return ycc;
}

function buildComponentPlane(ycc: Float32Array, width: number, height: number, channel: number, planeWidth: number, planeHeight: number, reduction: number): Float32Array {
    const plane = new Float32Array(planeWidth * planeHeight);
    const sampleCount = reduction * reduction;
    for (let y = 0; y < planeHeight; y++) {
        for (let x = 0; x < planeWidth; x++) {
            let sum = 0;
            for (let dy = 0; dy < reduction; dy++) {
                const sourceY = Math.min(height - 1, y * reduction + dy);
                for (let dx = 0; dx < reduction; dx++) {
                    const sourceX = Math.min(width - 1, x * reduction + dx);
                    sum += ycc[(sourceY * width + sourceX) * 3 + channel];
                }
            }
            plane[y * planeWidth + x] = sum / sampleCount;
        }
    }
    return plane;
}

const dctCosine = (() => {
    const table = new Float32Array(BLOCK_AREA);
    for (let x = 0; x < BLOCK_SIZE; x++) {
        for (let u = 0; u < BLOCK_SIZE; u++) {
            table[x * BLOCK_SIZE + u] = Math.cos((2 * x + 1) * u * Math.PI / 16) * (u === 0 ? Math.SQRT1_2 : 1);
        }
    }
    return table;
})();

const fdctWorkspace = new Float32Array(BLOCK_AREA);

function forwardDctBlock(block: Float32Array): void {
    const workspace = fdctWorkspace;
    for (let y = 0; y < BLOCK_SIZE; y++) {
        for (let u = 0; u < BLOCK_SIZE; u++) {
            let sum = 0;
            for (let x = 0; x < BLOCK_SIZE; x++) sum += block[y * BLOCK_SIZE + x] * dctCosine[x * BLOCK_SIZE + u];
            workspace[y * BLOCK_SIZE + u] = sum;
        }
    }
    for (let v = 0; v < BLOCK_SIZE; v++) {
        for (let u = 0; u < BLOCK_SIZE; u++) {
            let sum = 0;
            for (let y = 0; y < BLOCK_SIZE; y++) sum += workspace[y * BLOCK_SIZE + u] * dctCosine[y * BLOCK_SIZE + v];
            block[v * BLOCK_SIZE + u] = sum * 0.25;
        }
    }
}

function scaleQuantTable(standard: readonly number[], quality: number): Int32Array {
    const clampedQuality = Math.max(1, Math.min(100, quality));
    const scale = clampedQuality < 50 ? 5000 / clampedQuality : 200 - clampedQuality * 2;
    const table = new Int32Array(BLOCK_AREA);
    for (let i = 0; i < BLOCK_AREA; i++) table[i] = Math.max(1, Math.min(255, Math.floor((standard[i] * scale + 50) / 100)));
    return table;
}

function bitSizeOf(value: number): number {
    let magnitude = Math.abs(value);
    let size = 0;
    while (magnitude !== 0) {
        size++;
        magnitude >>= 1;
    }
    return size;
}

const STANDARD_LUMINANCE_QUANT = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99,
];

const STANDARD_CHROMINANCE_QUANT = [
    17, 18, 24, 47, 99, 99, 99, 99,
    18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
];

const STANDARD_DC_LUMINANCE: StandardHuffmanTable = {
    counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
    values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const STANDARD_DC_CHROMINANCE: StandardHuffmanTable = {
    counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0],
    values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const STANDARD_AC_LUMINANCE: StandardHuffmanTable = {
    counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7D],
    values: [
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
        0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08, 0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
        0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
        0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
        0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
        0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
        0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
        0xF9, 0xFA,
    ],
};

const STANDARD_AC_CHROMINANCE: StandardHuffmanTable = {
    counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77],
    values: [
        0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
        0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xA1, 0xB1, 0xC1, 0x09, 0x23, 0x33, 0x52, 0xF0,
        0x15, 0x62, 0x72, 0xD1, 0x0A, 0x16, 0x24, 0x34, 0xE1, 0x25, 0xF1, 0x17, 0x18, 0x19, 0x1A, 0x26,
        0x27, 0x28, 0x29, 0x2A, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
        0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
        0x88, 0x89, 0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5,
        0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3,
        0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA,
        0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
        0xF9, 0xFA,
    ],
};
