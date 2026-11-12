export interface Platform {
    readonly output: PlatformOutput;
    readonly input: PlatformInput;
    readonly screen: PlatformScreen;
    readonly files: FileSource;
    readonly inflate: Inflate;
    readonly workers?: WorkerFactory;
    readonly hardwareConcurrency: () => number;
    readonly requestedRasterWorkers?: () => number | undefined;
    readonly now: () => number;
    readonly onExit: (callback: () => void) => () => void;
}

export interface PlatformOutput {
    write(chunk: string): void;
    backlogged?(): boolean;
}

export interface PlatformInput {
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
    onResize(callback: () => void): () => void;
}

export interface FileStat {
    readonly size: number;
    readonly mtimeMs: number;
}

export interface FileSource {
    readBytes(path: string): Uint8Array;
    readText(path: string): string;
    exists(path: string): boolean;
    stat?(path: string): FileStat;
    write?(path: string, bytes: Uint8Array): void;
}

export type Inflate = (bytes: Uint8Array) => Uint8Array;

export interface AssetLoadOptions {
    readonly files?: FileSource;
    readonly inflate?: Inflate;
}

export const WORKER_ENTRY_POINT = "workerMain";

export interface WorkerPort {
    postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
    onMessage(callback: (message: unknown) => void): void;
}

export interface WorkerHandle extends WorkerPort {
    onError(callback: (error: unknown) => void): void;
    terminate(): void;
    unref?(): void;
}

export interface WorkerFactory {
    spawn(source: string, data: unknown): WorkerHandle;
}
