import type {
    FileSource,
    FileStat,
    Inflate,
    Platform,
    PlatformInput,
    PlatformOutput,
    PlatformScreen,
    TerminalSize,
    WorkerFactory,
} from "./platform";
import {normalizePath} from "./paths";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const INTERACTIVE = true;

export class MemoryOutput implements PlatformOutput {
    public readonly chunks: string[] = [];
    private _length = 0;

    public get length(): number {
        return this._length;
    }

    public write(chunk: string): void {
        this.chunks.push(chunk);
        this._length += chunk.length;
    }

    public text(): string {
        return this.chunks.join("");
    }

    public clear(): void {
        this.chunks.length = 0;
        this._length = 0;
    }
}

export class MemoryInput implements PlatformInput {
    public interactive: boolean;
    private reader: ((data: string) => void) | undefined;
    private readonly pending: string[];

    public constructor(interactive: boolean = INTERACTIVE, scripted: readonly string[] = []) {
        this.interactive = interactive;
        this.pending = [...scripted];
    }

    public get started(): boolean {
        return this.reader !== undefined;
    }

    public available(): boolean {
        return this.interactive;
    }

    public start(onData: (data: string) => void): void {
        this.reader = onData;
        while (this.pending.length > 0 && this.reader === onData) onData(this.pending.shift()!);
    }

    public stop(): void {
        this.reader = undefined;
    }

    public feed(data: string): void {
        if (this.reader === undefined) this.pending.push(data);
        else this.reader(data);
    }
}

export class MemoryScreen implements PlatformScreen {
    private readonly listeners = new Set<() => void>();

    public constructor(private columns: number, private rows: number) {
    }

    public size(): TerminalSize {
        return {columns: this.columns, rows: this.rows};
    }

    public onResize(callback: () => void): () => void {
        const listener = () => callback();
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public resize(columns: number, rows: number): void {
        this.columns = columns;
        this.rows = rows;
        for (const listener of [...this.listeners]) listener();
    }

    public get listenerCount(): number {
        return this.listeners.size;
    }
}

interface MemoryFile {
    readonly bytes: Uint8Array;
    readonly mtimeMs: number;
}

export class MemoryFileSource implements FileSource {
    private readonly entries = new Map<string, MemoryFile>();
    private clock = 0;

    public constructor(files: Readonly<Record<string, string | Uint8Array>> = {}) {
        for (const path of Object.keys(files)) this.set(path, files[path]);
    }

    public set(path: string, contents: string | Uint8Array, mtimeMs: number = ++this.clock): void {
        const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents.slice();
        this.entries.set(normalizePath(path), {bytes, mtimeMs});
    }

    public delete(path: string): boolean {
        return this.entries.delete(normalizePath(path));
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
        return {size: entry.bytes.length, mtimeMs: entry.mtimeMs};
    }

    public write(path: string, bytes: Uint8Array): void {
        this.set(path, bytes);
    }

    private entry(path: string): MemoryFile {
        const entry = this.entries.get(normalizePath(path));
        if (entry === undefined) throw new Error(`ENOENT: no such file in memory: ${path}`);
        return entry;
    }
}

export interface MemoryPlatformOptions {
    readonly columns?: number;
    readonly rows?: number;
    readonly files?: Readonly<Record<string, string | Uint8Array>>;
    readonly fileSource?: FileSource;
    readonly input?: readonly string[];
    readonly interactive?: boolean;
    readonly inflate?: Inflate;
    readonly workers?: WorkerFactory;
    readonly hardwareConcurrency?: number;
    readonly requestedRasterWorkers?: number;
    readonly now?: number;
}

export class MemoryPlatform implements Platform {
    public readonly output = new MemoryOutput();
    public readonly input: MemoryInput;
    public readonly screen: MemoryScreen;
    public readonly files: FileSource;
    public readonly workers?: WorkerFactory;

    private readonly _inflate?: Inflate;
    private readonly _hardwareConcurrency: number;
    private readonly _requestedRasterWorkers: number | undefined;
    private readonly exitCallbacks = new Set<() => void>();
    private _now: number;

    public constructor(options: MemoryPlatformOptions = {}) {
        this.input = new MemoryInput(options.interactive ?? INTERACTIVE, options.input ?? []);
        this.screen = new MemoryScreen(options.columns ?? DEFAULT_COLUMNS, options.rows ?? DEFAULT_ROWS);
        this.files = options.fileSource ?? new MemoryFileSource(options.files ?? {});
        this.workers = options.workers;
        this._inflate = options.inflate;
        this._hardwareConcurrency = options.hardwareConcurrency ?? 1;
        this._requestedRasterWorkers = options.requestedRasterWorkers;
        this._now = options.now ?? 0;
    }

    public readonly hardwareConcurrency = (): number => this._hardwareConcurrency;

    public readonly requestedRasterWorkers = (): number | undefined => this._requestedRasterWorkers;

    public readonly inflate = (bytes: Uint8Array): Uint8Array => {
        if (this._inflate === undefined) throw new Error("MemoryPlatform has no inflate; pass one in its options");
        return this._inflate(bytes);
    };

    public readonly now = (): number => this._now;

    public setNow(ms: number): void {
        this._now = ms;
    }

    public advance(ms: number): void {
        this._now += ms;
    }

    public readonly onExit = (callback: () => void): () => void => {
        const entry = () => callback();
        this.exitCallbacks.add(entry);
        return () => {
            this.exitCallbacks.delete(entry);
        };
    };

    public exit(): void {
        const callbacks = [...this.exitCallbacks];
        this.exitCallbacks.clear();
        for (const callback of callbacks) callback();
    }
}
