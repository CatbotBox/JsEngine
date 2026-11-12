export interface Platform {
    readonly files: FileSource;
    readonly inflate: Inflate;
    readonly workers?: WorkerFactory;
    readonly hardwareConcurrency: () => number;
    readonly requestedRasterWorkers?: () => number | undefined;
    readonly now: () => number;
    readonly onExit: (callback: () => void) => () => void;
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
    readonly files: FileSource;
    readonly inflate: Inflate;
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
