/**
 * Everything the engine needs from its host. Systems reach it through `this.world.platform`;
 * loaders that run without a world take the `AssetLoadOptions` slice of it.
 *
 * Top-level functions (`inflate`, `hardwareConcurrency`, `now`, `onExit`) must work when called
 * detached from the object, because a whole Platform can be handed to a loader as its options.
 */
export interface Platform {
    readonly output: PlatformOutput;
    /** Raw terminal bytes, escape sequences included. */
    readonly input: PlatformInput;
    readonly screen: PlatformScreen;
    readonly files: FileSource;
    readonly inflate: Inflate;
    /** Absent: the rasterizer stays single-threaded. */
    readonly workers?: WorkerFactory;
    readonly hardwareConcurrency: () => number;
    /** Raster worker threads the host asks for, overriding the count derived from `hardwareConcurrency`; undefined: no request. */
    readonly requestedRasterWorkers?: () => number | undefined;
    readonly now: () => number;
    /** Runs `callback` when the host shuts down; returns a function that cancels it. */
    readonly onExit: (callback: () => void) => () => void;
}

export interface PlatformOutput {
    write(chunk: string): void;
}

export interface PlatformInput {
    /** False when the host has no interactive input to read (e.g. piped stdin). */
    available(): boolean;
    start(onData: (data: string) => void): void;
    stop(): void;
}

export interface TerminalSize {
    readonly columns: number;
    readonly rows: number;
}

export interface PlatformScreen {
    size(): TerminalSize;
    /** Calls `callback` after the size changes; returns a function that unsubscribes it. */
    onResize(callback: () => void): () => void;
}

export interface FileStat {
    readonly size: number;
    readonly mtimeMs: number;
}

/**
 * Synchronous on purpose: a browser preloads its assets into memory before the world starts,
 * so every loader stays synchronous. `stat` and `write` are optional: without `write` the
 * source is read-only, without `stat` nothing can be validated against the file it came from.
 */
export interface FileSource {
    readBytes(path: string): Uint8Array;
    readText(path: string): string;
    exists(path: string): boolean;
    stat?(path: string): FileStat;
    write?(path: string, bytes: Uint8Array): void;
}

export type Inflate = (bytes: Uint8Array) => Uint8Array;

/** What a loader needs from the host; a Platform satisfies it. Absent members default to the node platform's. */
export interface AssetLoadOptions {
    readonly files?: FileSource;
    readonly inflate?: Inflate;
}

/**
 * The function a worker script must declare. A factory runs the script in a fresh worker,
 * then calls `workerMain(data, port)` once, where `data` is what was passed to `spawn`
 * (SharedArrayBuffers in it are shared, not copied). The script must not touch any host API
 * itself (no `require`, no `self`): the factory's bootstrap supplies everything through
 * `data` and `port`, which is what keeps one script working under worker_threads and
 * browser Workers alike.
 */
export const WORKER_ENTRY_POINT = "workerMain";

export interface WorkerPort {
    postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
    onMessage(callback: (message: unknown) => void): void;
}

export interface WorkerHandle extends WorkerPort {
    onError(callback: (error: unknown) => void): void;
    terminate(): void;
    /** Stops the worker from keeping the host process alive; absent where hosts have no such notion. */
    unref?(): void;
}

export interface WorkerFactory {
    spawn(source: string, data: unknown): WorkerHandle;
}
