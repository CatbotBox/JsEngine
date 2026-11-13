import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";
import {deflateRawSync} from "zlib";
import {describe, expect, test} from "../src/engine/testing/harness";
import {inflateRaw} from "../src/engine/assets/image/inflate";
import {
    CENTRAL_DIRECTORY_SIGNATURE,
    crc32,
    END_OF_CENTRAL_DIRECTORY_BYTES,
    END_OF_CENTRAL_DIRECTORY_SIGNATURE,
    LOCAL_FILE_HEADER_SIGNATURE,
    METHOD_DEFLATED,
    METHOD_STORED,
    UNIX_DIRECTORY,
    UNIX_MODE_SHIFT_BITS,
    UNIX_REGULAR_FILE,
    UNIX_SYMBOLIC_LINK,
    zipDirectory,
    ZipWriter,
} from "./zipArchive";
import type {ZipEntry} from "./zipArchive";

const CRC32_CHECK_INPUT = "123456789";
const CRC32_CHECK_VALUE = 0xcbf43926;
const UINT16_BYTES = 2;
const UINT32_BYTES = 4;
const LITTLE_ENDIAN = true;
const DOS_EPOCH_YEAR = 1980;
const DOS_YEAR_SHIFT_BITS = 9;
const DOS_MONTH_SHIFT_BITS = 5;
const DOS_MONTH_MASK = 0xf;
const DOS_DAY_MASK = 0x1f;
const DOS_HOUR_SHIFT_BITS = 11;
const DOS_MINUTE_SHIFT_BITS = 5;
const DOS_MINUTE_MASK = 0x3f;
const DOS_SECONDS_MASK = 0x1f;
const DOS_SECONDS_PER_UNIT = 2;
const MONTH_INDEX_TO_NUMBER = 1;
const REPEATS_FOR_COMPRESSIBLE_TEXT = 200;
const INCOMPRESSIBLE_BYTES = 64;
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_OUTPUT_SHIFT_BITS = 16;
const BYTE_MASK = 0xff;
const FILE_MODE = UNIX_REGULAR_FILE | 0o644;
const EXECUTABLE_MODE = UNIX_REGULAR_FILE | 0o755;
const DIRECTORY_MODE = UNIX_DIRECTORY | 0o755;
const SYMBOLIC_LINK_MODE = UNIX_SYMBOLIC_LINK | 0o777;
const UNIX_PERMISSION_AND_TYPE_MASK = 0xffff;

class LittleEndianReader {
    private readonly view: DataView;

    public constructor(private readonly bytes: Uint8Array, public cursor: number) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    public u16(): number {
        const value = this.view.getUint16(this.cursor, LITTLE_ENDIAN);
        this.cursor += UINT16_BYTES;
        return value;
    }

    public u32(): number {
        const value = this.view.getUint32(this.cursor, LITTLE_ENDIAN);
        this.cursor += UINT32_BYTES;
        return value;
    }

    public take(length: number): Uint8Array {
        const slice = this.bytes.slice(this.cursor, this.cursor + length);
        this.cursor += length;
        return slice;
    }
}

interface ParsedEntry {
    readonly path: string;
    readonly method: number;
    readonly crc: number;
    readonly bytes: Uint8Array;
    readonly unixMode: number;
    readonly dosTime: number;
    readonly dosDate: number;
}

function parseZip(archive: Uint8Array): ParsedEntry[] {
    const end = new LittleEndianReader(archive, archive.length - END_OF_CENTRAL_DIRECTORY_BYTES);
    expect(end.u32()).toBe(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
    end.u16();
    end.u16();
    const entriesOnDisk = end.u16();
    const entries = end.u16();
    expect(entriesOnDisk).toBe(entries);
    const directoryBytes = end.u32();
    const directoryOffset = end.u32();
    expect(directoryOffset + directoryBytes).toBe(archive.length - END_OF_CENTRAL_DIRECTORY_BYTES);

    const central = new LittleEndianReader(archive, directoryOffset);
    const parsed: ParsedEntry[] = [];
    for (let i = 0; i < entries; i++) {
        expect(central.u32()).toBe(CENTRAL_DIRECTORY_SIGNATURE);
        central.u16();
        central.u16();
        central.u16();
        const method = central.u16();
        const dosTime = central.u16();
        const dosDate = central.u16();
        const crc = central.u32();
        const compressedBytes = central.u32();
        const uncompressedBytes = central.u32();
        const nameBytes = central.u16();
        const extraBytes = central.u16();
        const commentBytes = central.u16();
        central.u16();
        central.u16();
        const externalAttributes = central.u32();
        const localHeaderOffset = central.u32();
        const path = new TextDecoder().decode(central.take(nameBytes));
        central.take(extraBytes + commentBytes);

        const local = new LittleEndianReader(archive, localHeaderOffset);
        expect(local.u32()).toBe(LOCAL_FILE_HEADER_SIGNATURE);
        local.u16();
        local.u16();
        expect(local.u16()).toBe(method);
        local.u16();
        local.u16();
        expect(local.u32()).toBe(crc);
        expect(local.u32()).toBe(compressedBytes);
        expect(local.u32()).toBe(uncompressedBytes);
        const localNameBytes = local.u16();
        const localExtraBytes = local.u16();
        expect(new TextDecoder().decode(local.take(localNameBytes))).toBe(path);
        local.take(localExtraBytes);
        const data = local.take(compressedBytes);
        const bytes = method === METHOD_DEFLATED ? inflateRaw(data) : data;
        expect(bytes.length).toBe(uncompressedBytes);
        parsed.push({path, method, crc, bytes, unixMode: (externalAttributes >>> UNIX_MODE_SHIFT_BITS) & UNIX_PERMISSION_AND_TYPE_MASK, dosTime, dosDate});
    }
    expect(central.cursor).toBe(directoryOffset + directoryBytes);
    return parsed;
}

function deflateRaw(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(deflateRawSync(bytes));
}

function pseudoRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    let state = 1;
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
        bytes[i] = (state >>> LCG_OUTPUT_SHIFT_BITS) & BYTE_MASK;
    }
    return bytes;
}

function zipInMemory(entries: readonly ZipEntry[]): Uint8Array {
    const chunks: Uint8Array[] = [];
    const writer = new ZipWriter(chunk => chunks.push(chunk), deflateRaw);
    for (const entry of entries) writer.add(entry);
    writer.finish();
    const archive = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        archive.set(chunk, offset);
        offset += chunk.length;
    }
    return archive;
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("zip writer", () => {
    test("crc32 matches the standard check value", () => {
        expect(crc32(encode(CRC32_CHECK_INPUT))).toBe(CRC32_CHECK_VALUE);
    });

    const modified = new Date(2026, 10, 13, 14, 37, 22);
    const entries: ZipEntry[] = [
        {path: "app/", bytes: new Uint8Array(0), modified, unixMode: DIRECTORY_MODE},
        {path: "app/readme.txt", bytes: encode("swarm ".repeat(REPEATS_FOR_COMPRESSIBLE_TEXT)), modified, unixMode: FILE_MODE},
        {path: "app/noise.bin", bytes: pseudoRandomBytes(INCOMPRESSIBLE_BYTES), modified, unixMode: FILE_MODE},
        {path: "app/empty", bytes: new Uint8Array(0), modified, unixMode: FILE_MODE},
        {path: "app/run", bytes: encode("#!/bin/sh\n"), modified, unixMode: EXECUTABLE_MODE},
        {path: "app/latest", bytes: encode("run"), modified, unixMode: SYMBOLIC_LINK_MODE},
        {path: "app/naïve ✓.txt", bytes: encode("utf-8 name"), modified, unixMode: FILE_MODE},
    ];
    const parsed = parseZip(zipInMemory(entries));

    test("every entry round-trips through the central directory and the engine's inflateRaw", () => {
        expect(parsed.map(entry => entry.path)).toEqual(entries.map(entry => entry.path));
        parsed.forEach((entry, index) => {
            expect([...entry.bytes]).toEqual([...entries[index].bytes]);
            expect(entry.crc).toBe(crc32(entries[index].bytes));
            expect(entry.unixMode).toBe(entries[index].unixMode);
        });
    });

    test("compressible data is deflated, incompressible and empty data is stored", () => {
        const methodOf = (path: string) => parsed.find(entry => entry.path === path)!.method;
        expect(methodOf("app/readme.txt")).toBe(METHOD_DEFLATED);
        expect(methodOf("app/noise.bin")).toBe(METHOD_STORED);
        expect(methodOf("app/empty")).toBe(METHOD_STORED);
        expect(methodOf("app/")).toBe(METHOD_STORED);
    });

    test("modification times are stored as local DOS date and time to two seconds", () => {
        const {dosDate, dosTime} = parsed[0];
        expect((dosDate >>> DOS_YEAR_SHIFT_BITS) + DOS_EPOCH_YEAR).toBe(modified.getFullYear());
        expect((dosDate >>> DOS_MONTH_SHIFT_BITS) & DOS_MONTH_MASK).toBe(modified.getMonth() + MONTH_INDEX_TO_NUMBER);
        expect(dosDate & DOS_DAY_MASK).toBe(modified.getDate());
        expect(dosTime >>> DOS_HOUR_SHIFT_BITS).toBe(modified.getHours());
        expect((dosTime >>> DOS_MINUTE_SHIFT_BITS) & DOS_MINUTE_MASK).toBe(modified.getMinutes());
        expect((dosTime & DOS_SECONDS_MASK) * DOS_SECONDS_PER_UNIT).toBe(modified.getSeconds() - (modified.getSeconds() % DOS_SECONDS_PER_UNIT));
    });

    test("adding after finish throws", () => {
        const writer = new ZipWriter(() => undefined, deflateRaw);
        writer.finish();
        expect(() => writer.add(entries[1])).toThrow("add after finish");
    });

    test("zipDirectory writes a folder tree under one root folder, sorted, with directory entries", () => {
        const scratch = mkdtempSync(join(tmpdir(), "zip-archive-test-"));
        try {
            const source = join(scratch, "packaged");
            mkdirSync(join(source, "resources"), {recursive: true});
            writeFileSync(join(source, "b.txt"), "second");
            writeFileSync(join(source, "a.txt"), "first");
            writeFileSync(join(source, "resources", "app.asar"), "asar ".repeat(REPEATS_FOR_COMPRESSIBLE_TEXT));
            const output = join(scratch, "packaged.zip");
            zipDirectory(source, output, "JsEngine-Swarm", deflateRaw);
            const zipped = parseZip(new Uint8Array(readFileSync(output)));
            expect(zipped.map(entry => entry.path)).toEqual([
                "JsEngine-Swarm/",
                "JsEngine-Swarm/a.txt",
                "JsEngine-Swarm/b.txt",
                "JsEngine-Swarm/resources/",
                "JsEngine-Swarm/resources/app.asar",
            ]);
            expect(new TextDecoder().decode(zipped[1].bytes)).toBe("first");
            expect(new TextDecoder().decode(zipped[4].bytes)).toBe("asar ".repeat(REPEATS_FOR_COMPRESSIBLE_TEXT));
            expect(zipped[3].unixMode & UNIX_DIRECTORY).toBe(UNIX_DIRECTORY);
        } finally {
            rmSync(scratch, {recursive: true, force: true});
        }
    });
});
