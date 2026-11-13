import {closeSync, lstatSync, openSync, readdirSync, readFileSync, readlinkSync, writeSync} from "fs";
import {join} from "path";

export type DeflateRaw = (bytes: Uint8Array) => Uint8Array;
export type ChunkSink = (chunk: Uint8Array) => void;

export interface ZipEntry {
    readonly path: string;
    readonly bytes: Uint8Array;
    readonly modified: Date;
    readonly unixMode: number;
}

export const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
export const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
export const LOCAL_FILE_HEADER_BYTES = 30;
export const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
export const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
export const METHOD_STORED = 0;
export const METHOD_DEFLATED = 8;
export const FLAG_UTF8_NAMES = 0x0800;
export const UNIX_FILE_TYPE_MASK = 0o170000;
export const UNIX_DIRECTORY = 0o040000;
export const UNIX_REGULAR_FILE = 0o100000;
export const UNIX_SYMBOLIC_LINK = 0o120000;
export const UNIX_MODE_SHIFT_BITS = 16;
export const MS_DOS_DIRECTORY_ATTRIBUTE = 0x10;
export const DIRECTORY_SUFFIX = "/";

const VERSION_NEEDED_DEFLATE = 20;
const HOST_UNIX = 3;
const HOST_SHIFT_BITS = 8;
const VERSION_MADE_BY_UNIX = (HOST_UNIX << HOST_SHIFT_BITS) | VERSION_NEEDED_DEFLATE;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const DOS_EPOCH_YEAR = 1980;
const DOS_MAX_YEAR = 2107;
const DOS_YEAR_SHIFT_BITS = 9;
const DOS_MONTH_SHIFT_BITS = 5;
const DOS_HOUR_SHIFT_BITS = 11;
const DOS_MINUTE_SHIFT_BITS = 5;
const DOS_SECONDS_PER_UNIT = 2;
const MONTH_INDEX_TO_NUMBER = 1;
const NO_EXTRA_FIELD_BYTES = 0;
const NO_COMMENT_BYTES = 0;
const DISK_ZERO = 0;
const NO_INTERNAL_ATTRIBUTES = 0;
const LITTLE_ENDIAN = true;
const CRC32_POLYNOMIAL = 0xedb88320;
const CRC32_INITIAL = 0xffffffff;
const CRC32_FINAL_XOR = 0xffffffff;
const BYTE_VALUES = 256;
const BITS_PER_BYTE = 8;
const LOW_BYTE_MASK = 0xff;

const CRC32_TABLE = (() => {
    const table = new Uint32Array(BYTE_VALUES);
    for (let n = 0; n < BYTE_VALUES; n++) {
        let c = n;
        for (let bit = 0; bit < BITS_PER_BYTE; bit++) c = c & 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(bytes: Uint8Array): number {
    let crc = CRC32_INITIAL;
    for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & LOW_BYTE_MASK] ^ (crc >>> BITS_PER_BYTE);
    return (crc ^ CRC32_FINAL_XOR) >>> 0;
}

interface DosDateTime {
    readonly date: number;
    readonly time: number;
}

function dosDateTime(when: Date): DosDateTime {
    const year = Math.min(DOS_MAX_YEAR, Math.max(DOS_EPOCH_YEAR, when.getFullYear()));
    const clamped = year !== when.getFullYear();
    const month = clamped ? MONTH_INDEX_TO_NUMBER : when.getMonth() + MONTH_INDEX_TO_NUMBER;
    const day = clamped ? 1 : when.getDate();
    const date = ((year - DOS_EPOCH_YEAR) << DOS_YEAR_SHIFT_BITS) | (month << DOS_MONTH_SHIFT_BITS) | day;
    const time = clamped ? 0 : (when.getHours() << DOS_HOUR_SHIFT_BITS) | (when.getMinutes() << DOS_MINUTE_SHIFT_BITS) | Math.floor(when.getSeconds() / DOS_SECONDS_PER_UNIT);
    return {date, time};
}

function requireUint32(value: number, what: string): number {
    if (value > MAX_UINT32) throw new Error(`zip: ${what} is ${value} bytes, past the 4 GiB limit of a zip without zip64`);
    return value;
}

const UINT16_BYTES = 2;
const UINT32_BYTES = 4;

class LittleEndianRecord {
    private readonly bytes: Uint8Array;
    private readonly view: DataView;
    private cursor = 0;

    public constructor(lengthBytes: number) {
        this.bytes = new Uint8Array(lengthBytes);
        this.view = new DataView(this.bytes.buffer);
    }

    public u16(value: number): this {
        this.view.setUint16(this.cursor, value, LITTLE_ENDIAN);
        this.cursor += UINT16_BYTES;
        return this;
    }

    public u32(value: number): this {
        this.view.setUint32(this.cursor, value, LITTLE_ENDIAN);
        this.cursor += UINT32_BYTES;
        return this;
    }

    public append(bytes: Uint8Array): this {
        this.bytes.set(bytes, this.cursor);
        this.cursor += bytes.length;
        return this;
    }

    public complete(): Uint8Array {
        if (this.cursor !== this.bytes.length) throw new Error(`zip: record filled ${this.cursor} of ${this.bytes.length} bytes`);
        return this.bytes;
    }
}

interface CentralRecord {
    readonly name: Uint8Array;
    readonly method: number;
    readonly crc: number;
    readonly compressedBytes: number;
    readonly uncompressedBytes: number;
    readonly dateTime: DosDateTime;
    readonly externalAttributes: number;
    readonly localHeaderOffset: number;
}

export class ZipWriter {
    private readonly records: CentralRecord[] = [];
    private writtenBytes = 0;
    private finished = false;

    public constructor(private readonly sink: ChunkSink, private readonly deflateRaw: DeflateRaw) {
    }

    public add(entry: ZipEntry): void {
        if (this.finished) throw new Error("zip: add after finish");
        if (this.records.length === MAX_UINT16) throw new Error(`zip: more than ${MAX_UINT16} entries needs zip64`);
        const isDirectory = (entry.unixMode & UNIX_FILE_TYPE_MASK) === UNIX_DIRECTORY;
        const deflated = isDirectory || entry.bytes.length === 0 ? undefined : this.deflateRaw(entry.bytes);
        const useDeflate = deflated !== undefined && deflated.length < entry.bytes.length;
        const data = useDeflate ? deflated : entry.bytes;
        const record: CentralRecord = {
            name: new TextEncoder().encode(entry.path),
            method: useDeflate ? METHOD_DEFLATED : METHOD_STORED,
            crc: crc32(entry.bytes),
            compressedBytes: requireUint32(data.length, entry.path),
            uncompressedBytes: requireUint32(entry.bytes.length, entry.path),
            dateTime: dosDateTime(entry.modified),
            externalAttributes: ((entry.unixMode << UNIX_MODE_SHIFT_BITS) | (isDirectory ? MS_DOS_DIRECTORY_ATTRIBUTE : 0)) >>> 0,
            localHeaderOffset: requireUint32(this.writtenBytes, "archive offset"),
        };
        this.write(this.localHeader(record));
        this.write(data);
        this.records.push(record);
    }

    public finish(): void {
        if (this.finished) return;
        this.finished = true;
        const directoryOffset = requireUint32(this.writtenBytes, "central directory offset");
        for (const record of this.records) this.write(this.centralHeader(record));
        const directoryBytes = requireUint32(this.writtenBytes - directoryOffset, "central directory");
        this.write(this.endOfCentralDirectory(directoryOffset, directoryBytes));
    }

    private write(chunk: Uint8Array): void {
        this.sink(chunk);
        this.writtenBytes += chunk.length;
    }

    private localHeader(record: CentralRecord): Uint8Array {
        return new LittleEndianRecord(LOCAL_FILE_HEADER_BYTES + record.name.length)
            .u32(LOCAL_FILE_HEADER_SIGNATURE)
            .u16(VERSION_NEEDED_DEFLATE)
            .u16(FLAG_UTF8_NAMES)
            .u16(record.method)
            .u16(record.dateTime.time)
            .u16(record.dateTime.date)
            .u32(record.crc)
            .u32(record.compressedBytes)
            .u32(record.uncompressedBytes)
            .u16(record.name.length)
            .u16(NO_EXTRA_FIELD_BYTES)
            .append(record.name)
            .complete();
    }

    private centralHeader(record: CentralRecord): Uint8Array {
        return new LittleEndianRecord(CENTRAL_DIRECTORY_HEADER_BYTES + record.name.length)
            .u32(CENTRAL_DIRECTORY_SIGNATURE)
            .u16(VERSION_MADE_BY_UNIX)
            .u16(VERSION_NEEDED_DEFLATE)
            .u16(FLAG_UTF8_NAMES)
            .u16(record.method)
            .u16(record.dateTime.time)
            .u16(record.dateTime.date)
            .u32(record.crc)
            .u32(record.compressedBytes)
            .u32(record.uncompressedBytes)
            .u16(record.name.length)
            .u16(NO_EXTRA_FIELD_BYTES)
            .u16(NO_COMMENT_BYTES)
            .u16(DISK_ZERO)
            .u16(NO_INTERNAL_ATTRIBUTES)
            .u32(record.externalAttributes)
            .u32(record.localHeaderOffset)
            .append(record.name)
            .complete();
    }

    private endOfCentralDirectory(directoryOffset: number, directoryBytes: number): Uint8Array {
        return new LittleEndianRecord(END_OF_CENTRAL_DIRECTORY_BYTES)
            .u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE)
            .u16(DISK_ZERO)
            .u16(DISK_ZERO)
            .u16(this.records.length)
            .u16(this.records.length)
            .u32(directoryBytes)
            .u32(directoryOffset)
            .u16(NO_COMMENT_BYTES)
            .complete();
    }
}

const NO_BYTES = new Uint8Array(0);

function addTree(writer: ZipWriter, directory: string, archivePath: string): void {
    const directoryStat = lstatSync(directory);
    writer.add({path: archivePath + DIRECTORY_SUFFIX, bytes: NO_BYTES, modified: directoryStat.mtime, unixMode: directoryStat.mode});
    const names = readdirSync(directory).sort();
    for (const name of names) {
        const source = join(directory, name);
        const entryPath = `${archivePath}${DIRECTORY_SUFFIX}${name}`;
        const stat = lstatSync(source);
        if (stat.isDirectory()) addTree(writer, source, entryPath);
        else if (stat.isSymbolicLink()) writer.add({path: entryPath, bytes: new TextEncoder().encode(readlinkSync(source)), modified: stat.mtime, unixMode: stat.mode});
        else writer.add({path: entryPath, bytes: new Uint8Array(readFileSync(source)), modified: stat.mtime, unixMode: stat.mode});
    }
}

export function zipDirectory(sourceDirectory: string, outputPath: string, rootFolderName: string, deflateRaw: DeflateRaw): void {
    const descriptor = openSync(outputPath, "w");
    try {
        const writer = new ZipWriter(chunk => writeSync(descriptor, chunk), deflateRaw);
        addTree(writer, sourceDirectory, rootFolderName);
        writer.finish();
    } finally {
        closeSync(descriptor);
    }
}
