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
 * made-up time.
 */
export interface PreloadEntry {
    readonly path: string;
    readonly mtimeMs?: number;
}

export interface PreloadedFileSourceOptions {
    /** Prefixed to every normalized path to form its URL; default "" (relative to the page). */
    readonly baseUrl?: string;
    /** Default: the host's global `fetch`. */
    readonly fetch?: FetchFile;
}

interface PreloadedFile {
    readonly bytes: Uint8Array;
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

    public async preload(entries: readonly (string | PreloadEntry)[]): Promise<void> {
        await Promise.all(entries.map(entry => this.preloadOne(typeof entry === "string" ? {path: entry} : entry)));
    }

    public paths(): string[] {
        return [...this.entries.keys()];
    }

    public readBytes(path: string): Uint8Array {
        return this.entry(path).bytes;
    }

    public readText(path: string): string {
        return new TextDecoder("utf-8", {ignoreBOM: true}).decode(this.entry(path).bytes);
    }

    public exists(path: string): boolean {
        return this.entries.has(normalizePath(path));
    }

    public stat(path: string): FileStat {
        const entry = this.entry(path);
        if (entry.mtimeMs === undefined) {
            throw new Error(`${path} was preloaded without a modification time; list it with mtimeMs to stat it`);
        }
        return {size: entry.bytes.length, mtimeMs: entry.mtimeMs};
    }

    private async preloadOne(entry: PreloadEntry): Promise<void> {
        const url = this.urlFor(entry.path);
        const response = await this.fetchFile(url);
        if (response.status === 404) return;
        if (!response.ok) throw new Error(`Could not preload ${entry.path} from ${url}: HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        this.entries.set(normalizePath(entry.path), {bytes, mtimeMs: entry.mtimeMs});
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
