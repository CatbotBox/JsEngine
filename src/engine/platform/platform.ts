export interface Platform {
    readonly files: FileSource;
    readonly inflate: Inflate;
    readonly workers?: WorkerFactory;
    readonly hardwareConcurrency: () => number;
    readonly requestedRasterWorkers?: () => number | undefined;
    readonly now: () => number;
    readonly onExit: (callback: () => void) => () => void;
    readonly quit: () => void;
    readonly frameScheduler?: FrameScheduler;
}

export type FramePacing =
    | {readonly kind: "interval", readonly intervalMs: number}
    | {readonly kind: "uncapped"}
    | {readonly kind: "display", readonly capIntervalMs?: number};

export type FrameCallback = (frameTimeMs: number) => void;

export interface PresentationBacklog {
    backlogged(): boolean;
    onPresented(listener: () => void): () => void;
}

export interface FrameScheduler {
    start(pacing: FramePacing, onFrame: FrameCallback, backlog?: PresentationBacklog): () => void;
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

export type PlatformFeature = "dom" | "node" | "bun" | "gpu" | "workers" | "sharedMemory" | "audio";

export const PLATFORM_FEATURES: readonly PlatformFeature[] = ["dom", "node", "bun", "gpu", "workers", "sharedMemory", "audio"];

export const PLATFORM_FEATURE_CONSTANTS: Readonly<Record<PlatformFeature, string>> = {
    dom: "JSENGINE_HAS_DOM",
    node: "JSENGINE_HAS_NODE",
    bun: "JSENGINE_HAS_BUN",
    gpu: "JSENGINE_HAS_GPU",
    workers: "JSENGINE_HAS_WORKERS",
    sharedMemory: "JSENGINE_HAS_SHARED_MEMORY",
    audio: "JSENGINE_HAS_AUDIO",
};

interface FeatureProbeGlobals {
    readonly document?: unknown;
    readonly WorkerGlobalScope?: unknown;
    readonly process?: {readonly versions?: {readonly node?: string}};
    readonly Bun?: unknown;
    readonly navigator?: {readonly gpu?: unknown};
    readonly Worker?: unknown;
    readonly SharedArrayBuffer?: unknown;
    readonly AudioContext?: unknown;
}

function builtFeature(feature: PlatformFeature): boolean | undefined {
    switch (feature) {
        case "dom":
            return typeof JSENGINE_HAS_DOM === "undefined" ? undefined : JSENGINE_HAS_DOM;
        case "node":
            return typeof JSENGINE_HAS_NODE === "undefined" ? undefined : JSENGINE_HAS_NODE;
        case "bun":
            return typeof JSENGINE_HAS_BUN === "undefined" ? undefined : JSENGINE_HAS_BUN;
        case "gpu":
            return typeof JSENGINE_HAS_GPU === "undefined" ? undefined : JSENGINE_HAS_GPU;
        case "workers":
            return typeof JSENGINE_HAS_WORKERS === "undefined" ? undefined : JSENGINE_HAS_WORKERS;
        case "sharedMemory":
            return typeof JSENGINE_HAS_SHARED_MEMORY === "undefined" ? undefined : JSENGINE_HAS_SHARED_MEMORY;
        case "audio":
            return typeof JSENGINE_HAS_AUDIO === "undefined" ? undefined : JSENGINE_HAS_AUDIO;
    }
}

function detectedFeature(feature: PlatformFeature, globals: FeatureProbeGlobals): boolean {
    switch (feature) {
        case "dom":
            return globals.document !== undefined || globals.WorkerGlobalScope !== undefined;
        case "node":
            return globals.process?.versions?.node !== undefined;
        case "bun":
            return globals.Bun !== undefined;
        case "gpu":
            return globals.navigator?.gpu !== undefined;
        case "workers":
            return typeof globals.Worker === "function" || detectedFeature("node", globals);
        case "sharedMemory":
            return typeof globals.SharedArrayBuffer === "function";
        case "audio":
            return typeof globals.AudioContext === "function";
    }
}

export function hasFeature(feature: PlatformFeature): boolean {
    return builtFeature(feature) !== false && detectedFeature(feature, globalThis as FeatureProbeGlobals);
}

export function optionalFeature<T>(feature: PlatformFeature, probe: () => T): T | undefined {
    return builtFeature(feature) === false ? undefined : probe();
}
