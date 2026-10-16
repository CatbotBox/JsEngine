import type {FileSource, FileStat} from "./platform";
import {normalizePath} from "./paths";

export interface ByteStreamReader {
    read(): Promise<{readonly done: boolean, readonly value?: Uint8Array}>;
}

/** What a fetch body or a DecompressionStream's readable side offers; a web `ReadableStream<Uint8Array>` satisfies it. */
export interface ByteStream {
    getReader(): ByteStreamReader;
}

export interface FetchedFile {
    readonly ok: boolean;
    readonly status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
    /** Read as it arrives where present, so progress moves within one file; absent: `arrayBuffer` at once. */
    readonly body?: ByteStream | null;
}

export type FetchFile = (url: string) => Promise<FetchedFile>;

/**
 * A manifest entry. `mtimeMs` is the modification time of the file the asset was built from;
 * only entries that carry one can be `stat`ed, so a mesh cache is never validated against a
 * made-up time. `size`, when given, is checked against the bytes fetched, so a stale build fails
 * loudly instead of silently invalidating whatever is keyed on the file.
 */
export interface PreloadEntry {
    readonly path: string;
    readonly mtimeMs?: number;
    readonly size?: number;
    /**
     * Not fetched: the file exists and `stat`s from `size` and `mtimeMs` (both required), but its
     * bytes cannot be read. For an obj whose mesh cache replaces it, which only `stat`s the obj.
     */
    readonly statOnly?: boolean;
    /**
     * Not fetched by `preload`: the file exists and `stat`s like any other, but its bytes arrive
     * only through `ensureLoaded`. For a large file a page may never need. Needs `size`.
     */
    readonly lazy?: boolean;
    /**
     * Shipped gzip-compressed and split into parts, fetched from `<url>.gz.part0`, `.gz.part1`...
     * and decompressed as they arrive; each number is one part's size in bytes. `size` stays the
     * decompressed size.
     */
    readonly gzipParts?: readonly number[];
}

/** Bytes are transferred bytes: a gzip-compressed entry counts its parts, not what they decompress to. */
export interface PreloadProgress {
    readonly loadedFiles: number;
    readonly totalFiles: number;
    /** Of the entries that list a `size`; stat-only entries count as no bytes. */
    readonly loadedBytes: number;
    readonly totalBytes: number;
}

export interface PreloadedFileSourceOptions {
    /** Prefixed to every normalized path to form its URL; default "" (relative to the page). */
    readonly baseUrl?: string;
    /** Default: the host's global `fetch`. */
    readonly fetch?: FetchFile;
}

interface PreloadedFile {
    /** Undefined for a stat-only entry, and for a lazy one until it is loaded. */
    readonly bytes: Uint8Array | undefined;
    readonly size: number;
    readonly mtimeMs: number | undefined;
    /** The manifest entry of a lazy file whose bytes have not arrived yet. */
    readonly pending?: PreloadEntry;
}

interface LazyLoad {
    done: Promise<void>;
    readonly totalBytes: number;
    loadedBytes: number;
    readonly listeners: Set<() => void>;
}

interface GunzipStream {
    readonly writable: {
        getWriter(): {
            write(chunk: Uint8Array): Promise<void>;
            close(): Promise<void>;
            abort(reason?: unknown): Promise<void>;
        };
    };
    readonly readable: ByteStream;
}

/**
 * Read-only files fetched into memory, so every loader stays synchronous: `preload` before the
 * world starts, `ensureLoaded` for lazy entries before the loader that reads them runs. Paths are
 * keyed normalized, as in `MemoryFileSource`. A path the server answers 404 for is recorded as
 * absent, exactly like a missing file on disk: `exists` is false and reads throw ENOENT.
 */
export class PreloadedFileSource implements FileSource {
    private readonly entries = new Map<string, PreloadedFile>();
    private readonly lazyLoads = new Map<string, LazyLoad>();
    private readonly baseUrl: string;
    private readonly fetchFile: FetchFile;

    public constructor(options: PreloadedFileSourceOptions = {}) {
        this.baseUrl = options.baseUrl ?? "";
        this.fetchFile = options.fetch ?? (url => (globalThis as unknown as {fetch: FetchFile}).fetch(url));
    }

    public urlFor(path: string): string {
        return this.baseUrl + encodeURI(normalizePath(path));
    }

    /**
     * Fetches every entry except lazy ones, which are only registered. `onProgress` is called once
     * at the start, as bytes arrive, and once per entry as it completes, in completion order; lazy
     * entries are not part of it.
     */
    public async preload(entries: readonly (string | PreloadEntry)[], onProgress?: (progress: PreloadProgress) => void): Promise<void> {
        const fetched: PreloadEntry[] = [];
        for (const listed of entries) {
            const entry = typeof listed === "string" ? {path: listed} : listed;
            if (entry.lazy === true && entry.statOnly !== true) this.registerLazy(entry);
            else fetched.push(entry);
        }
        const totalBytes = fetched.reduce((sum, entry) => sum + transferBytesOf(entry), 0);
        let loadedFiles = 0;
        let loadedBytes = 0;
        const report = () => onProgress?.({loadedFiles, totalFiles: fetched.length, loadedBytes, totalBytes});
        report();
        await Promise.all(fetched.map(async entry => {
            const expected = transferBytesOf(entry);
            let counted = 0;
            await this.preloadOne(entry, count => {
                const added = Math.min(count, expected - counted);
                if (added <= 0) return;
                counted += added;
                loadedBytes += added;
                report();
            });
            loadedFiles++;
            loadedBytes += expected - counted;
            report();
        }));
    }

    /** True while `path` is a lazy entry whose bytes `ensureLoaded` has not fetched yet. */
    public isPending(path: string): boolean {
        return this.entries.get(normalizePath(path))?.pending !== undefined;
    }

    /**
     * Fetches whichever of `paths` are pending lazy entries; every other path is already as loaded
     * as it will be. Resolves once all of them can be read. A path another call is already fetching
     * is not fetched twice. `onProgress` covers this call's pending paths: it is called once at the
     * start, as bytes arrive and as each file completes. On a failure the entry stays pending, so a
     * later call fetches it again.
     */
    public async ensureLoaded(paths: readonly string[], onProgress?: (progress: PreloadProgress) => void): Promise<void> {
        const pending = [...new Set(paths.map(normalizePath))].filter(path => this.isPending(path));
        if (pending.length === 0) return;
        const loads = pending.map(path => this.lazyLoadOf(path));
        const totalBytes = loads.reduce((sum, load) => sum + load.totalBytes, 0);
        let loadedFiles = 0;
        const report = () => onProgress?.({
            loadedFiles,
            totalFiles: loads.length,
            loadedBytes: loads.reduce((sum, load) => sum + load.loadedBytes, 0),
            totalBytes,
        });
        for (const load of loads) load.listeners.add(report);
        report();
        try {
            await Promise.all(loads.map(async load => {
                await load.done;
                loadedFiles++;
                report();
            }));
        } finally {
            for (const load of loads) load.listeners.delete(report);
        }
    }

    public paths(): string[] {
        return [...this.entries.keys()];
    }

    public readBytes(path: string): Uint8Array {
        return this.bytesOf(path);
    }

    public readText(path: string): string {
        return new TextDecoder("utf-8", {ignoreBOM: true}).decode(this.bytesOf(path));
    }

    public exists(path: string): boolean {
        return this.entries.has(normalizePath(path));
    }

    public stat(path: string): FileStat {
        const entry = this.entry(path);
        if (entry.mtimeMs === undefined) {
            throw new Error(`${path} was preloaded without a modification time; list it with mtimeMs to stat it`);
        }
        return {size: entry.size, mtimeMs: entry.mtimeMs};
    }

    private registerLazy(entry: PreloadEntry): void {
        if (entry.size === undefined) throw new Error(`${entry.path} is listed lazy, which needs its size`);
        const path = normalizePath(entry.path);
        if (this.entries.get(path)?.bytes !== undefined) return;
        this.entries.set(path, {bytes: undefined, size: entry.size, mtimeMs: entry.mtimeMs, pending: entry});
    }

    private lazyLoadOf(path: string): LazyLoad {
        const running = this.lazyLoads.get(path);
        if (running !== undefined) return running;
        const entry = this.entries.get(path)!.pending!;
        const load: LazyLoad = {done: Promise.resolve(), totalBytes: transferBytesOf(entry), loadedBytes: 0, listeners: new Set()};
        this.lazyLoads.set(path, load);
        load.done = this.fetchLazy(path, entry, load);
        return load;
    }

    private async fetchLazy(path: string, entry: PreloadEntry, load: LazyLoad): Promise<void> {
        try {
            await this.preloadOne(entry, count => {
                load.loadedBytes = Math.min(load.totalBytes, load.loadedBytes + count);
                for (const listener of [...load.listeners]) listener();
            });
            load.loadedBytes = load.totalBytes;
        } finally {
            this.lazyLoads.delete(path);
        }
    }

    private async preloadOne(entry: PreloadEntry, onBytes: (count: number) => void): Promise<void> {
        const path = normalizePath(entry.path);
        if (entry.statOnly === true) {
            if (entry.size === undefined || entry.mtimeMs === undefined) {
                throw new Error(`${entry.path} is listed stat-only, which needs both its size and mtimeMs`);
            }
            this.entries.set(path, {bytes: undefined, size: entry.size, mtimeMs: entry.mtimeMs});
            return;
        }
        const bytes = entry.gzipParts === undefined
            ? await this.fetchPlain(entry, onBytes)
            : await this.fetchGzipParts(entry, entry.gzipParts, onBytes);
        if (bytes === undefined) this.entries.delete(path);
        else this.entries.set(path, {bytes, size: bytes.length, mtimeMs: entry.mtimeMs});
    }

    /** Undefined when the server has no such file. */
    private async fetchPlain(entry: PreloadEntry, onBytes: (count: number) => void): Promise<Uint8Array | undefined> {
        const url = this.urlFor(entry.path);
        const response = await this.fetchFile(url);
        if (response.status === 404) return undefined;
        if (!response.ok) throw httpFailure(entry.path, url, response.status);
        if (response.body === undefined || response.body === null) {
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (entry.size !== undefined && bytes.length !== entry.size) throw sizeMismatch(entry.path, bytes.length, entry.size);
            return bytes;
        }
        return await readStream(response.body, entry.size, entry.path, onBytes);
    }

    /** Undefined when the server has no first part; a later part missing is a broken build. */
    private async fetchGzipParts(entry: PreloadEntry, parts: readonly number[], onBytes: (count: number) => void): Promise<Uint8Array | undefined> {
        const url = this.urlFor(entry.path);
        const gunzip = createGunzip(entry.path);
        const writer = gunzip.writable.getWriter();
        const output = readStream(gunzip.readable, entry.size, entry.path);
        output.catch(() => undefined);
        try {
            for (let part = 0; part < parts.length; part++) {
                const partUrl = `${url}.gz.part${part}`;
                const response = await this.fetchFile(partUrl);
                if (part === 0 && response.status === 404) {
                    await writer.abort().catch(() => undefined);
                    return undefined;
                }
                if (!response.ok) throw httpFailure(`${entry.path} (part ${part})`, partUrl, response.status);
                let received = 0;
                await forEachChunk(response, async chunk => {
                    received += chunk.length;
                    await writer.write(chunk);
                    onBytes(chunk.length);
                });
                if (received !== parts[part]) throw sizeMismatch(`${entry.path} (part ${part})`, received, parts[part]);
            }
            await writer.close();
            return await output;
        } catch (error) {
            await writer.abort(error).catch(() => undefined);
            throw error;
        }
    }

    private bytesOf(path: string): Uint8Array {
        const entry = this.entry(path);
        if (entry.pending !== undefined) throw new Error(`${path} is lazy and not loaded yet; await ensureLoaded first`);
        if (entry.bytes === undefined) throw new Error(`${path} was preloaded stat-only; its contents were not fetched`);
        return entry.bytes;
    }

    private entry(path: string): PreloadedFile {
        const entry = this.entries.get(normalizePath(path));
        if (entry === undefined) throw notPreloaded(path);
        return entry;
    }
}

function transferBytesOf(entry: PreloadEntry): number {
    if (entry.statOnly === true) return 0;
    if (entry.gzipParts !== undefined) return entry.gzipParts.reduce((sum, part) => sum + part, 0);
    return entry.size ?? 0;
}

function createGunzip(path: string): GunzipStream {
    const Decompression = (globalThis as unknown as {DecompressionStream?: new (format: "gzip") => GunzipStream}).DecompressionStream;
    if (Decompression === undefined) throw new Error(`${path} is shipped gzip-compressed and this host has no DecompressionStream`);
    return new Decompression("gzip");
}

async function forEachChunk(response: FetchedFile, onChunk: (chunk: Uint8Array) => Promise<void>): Promise<void> {
    if (response.body === undefined || response.body === null) {
        await onChunk(new Uint8Array(await response.arrayBuffer()));
        return;
    }
    const reader = response.body.getReader();
    for (;;) {
        const {done, value} = await reader.read();
        if (done) return;
        if (value !== undefined && value.length > 0) await onChunk(value);
    }
}

/** Reads `stream` to its end; with a `size` it fills one array of that size and fails on any other length. */
async function readStream(stream: ByteStream, size: number | undefined, path: string, onBytes?: (count: number) => void): Promise<Uint8Array> {
    const reader = stream.getReader();
    const target = size === undefined ? undefined : new Uint8Array(size);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        if (value === undefined || value.length === 0) continue;
        if (target === undefined) chunks.push(value);
        else if (length + value.length <= target.length) target.set(value, length);
        length += value.length;
        onBytes?.(value.length);
    }
    if (target !== undefined) {
        if (length !== target.length) throw sizeMismatch(path, length, target.length);
        return target;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

function httpFailure(what: string, url: string, status: number): Error {
    return new Error(`Could not preload ${what} from ${url}: HTTP ${status}`);
}

function sizeMismatch(what: string, actual: number, listed: number): Error {
    return new Error(`Preloaded ${what} is ${actual} bytes, the manifest lists ${listed}; rebuild the assets`);
}

function notPreloaded(path: string): Error {
    const error = new Error(`ENOENT: no such file or directory, not preloaded: ${path}`) as Error & {code: string};
    error.code = "ENOENT";
    return error;
}
