import type {FileSource, FileStat} from "./platform";
import {normalizePath} from "./paths";

export interface FetchedFile {
    readonly ok: boolean;
    readonly status: number;
    arrayBuffer(): Promise<ArrayBuffer>;
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
}

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
    /** Undefined for a stat-only entry. */
    readonly bytes: Uint8Array | undefined;
    readonly size: number;
    readonly mtimeMs: number | undefined;
}

/**
 * Read-only files fetched into memory before the world starts, so every loader stays synchronous.
 * Paths are keyed normalized, as in `MemoryFileSource`. A path the server answers 404 for is
 * recorded as absent, exactly like a missing file on disk: `exists` is false and reads throw ENOENT.
 */
export class PreloadedFileSource implements FileSource {
    private readonly entries = new Map<string, PreloadedFile>();
    private readonly baseUrl: string;
    private readonly fetchFile: FetchFile;

    public constructor(options: PreloadedFileSourceOptions = {}) {
        this.baseUrl = options.baseUrl ?? "";
        this.fetchFile = options.fetch ?? (url => (globalThis as unknown as {fetch: FetchFile}).fetch(url));
    }

    public urlFor(path: string): string {
        return this.baseUrl + encodeURI(normalizePath(path));
    }

    /** `onProgress` is called once per entry as it completes, in completion order. */
    public async preload(entries: readonly (string | PreloadEntry)[], onProgress?: (progress: PreloadProgress) => void): Promise<void> {
        const listed = entries.map(entry => typeof entry === "string" ? {path: entry} : entry);
        const bytesOf = (entry: PreloadEntry) => entry.statOnly === true ? 0 : entry.size ?? 0;
        const totalBytes = listed.reduce((sum, entry) => sum + bytesOf(entry), 0);
        let loadedFiles = 0;
        let loadedBytes = 0;
        await Promise.all(listed.map(async entry => {
            await this.preloadOne(entry);
            loadedFiles++;
            loadedBytes += bytesOf(entry);
            onProgress?.({loadedFiles, totalFiles: listed.length, loadedBytes, totalBytes});
        }));
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

    private async preloadOne(entry: PreloadEntry): Promise<void> {
        if (entry.statOnly === true) {
            if (entry.size === undefined || entry.mtimeMs === undefined) {
                throw new Error(`${entry.path} is listed stat-only, which needs both its size and mtimeMs`);
            }
            this.entries.set(normalizePath(entry.path), {bytes: undefined, size: entry.size, mtimeMs: entry.mtimeMs});
            return;
        }
        const url = this.urlFor(entry.path);
        const response = await this.fetchFile(url);
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`Could not preload ${entry.path} from ${url}: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (entry.size !== undefined && bytes.length !== entry.size) {
            throw new Error(`Preloaded ${entry.path} is ${bytes.length} bytes, the manifest lists ${entry.size}; rebuild the assets`);
        }
        this.entries.set(normalizePath(entry.path), {bytes, size: bytes.length, mtimeMs: entry.mtimeMs});
    }

    private bytesOf(path: string): Uint8Array {
        const entry = this.entry(path);
        if (entry.bytes === undefined) throw new Error(`${path} was preloaded stat-only; its contents were not fetched`);
        return entry.bytes;
    }

    private entry(path: string): PreloadedFile {
        const entry = this.entries.get(normalizePath(path));
        if (entry === undefined) throw notPreloaded(path);
        return entry;
    }
}

function notPreloaded(path: string): Error {
    const error = new Error(`ENOENT: no such file or directory, not preloaded: ${path}`) as Error & {code: string};
    error.code = "ENOENT";
    return error;
}
