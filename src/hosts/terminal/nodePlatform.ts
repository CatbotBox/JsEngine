import type {FileSource, Platform, WorkerFactory} from "../../engine/platform/platform";
import {WORKER_ENTRY_POINT} from "../../engine/platform/platform";

interface NodeProcess {
    readonly env: Readonly<Record<string, string | undefined>>;
    once(event: "exit" | "SIGTERM", listener: () => void): void;
    removeListener(event: "exit" | "SIGTERM", listener: () => void): void;
}

interface NodeFs {
    readFileSync(path: string): Uint8Array;
    readFileSync(path: string, encoding: "utf8"): string;
    existsSync(path: string): boolean;
    statSync(path: string): {readonly size: number, readonly mtimeMs: number};
    writeFileSync(path: string, bytes: Uint8Array): void;
    mkdirSync(path: string, options: {recursive: true}): unknown;
    createWriteStream(path: string, options: {flags: "a" | "w"}): AppendStream;
}

interface NodeZlib {
    inflateSync(bytes: Uint8Array): Uint8Array;
    deflateSync(bytes: Uint8Array): Uint8Array;
}

interface NodeWorker {
    postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
    on(event: "message" | "error", listener: (value: unknown) => void): void;
    terminate(): unknown;
    unref(): void;
}

interface NodeWorkerThreads {
    readonly Worker: new (source: string, options: {eval: true, workerData: unknown}) => NodeWorker;
}

interface NodeOs {
    availableParallelism?(): number;
    cpus(): readonly unknown[];
}

interface NodeUtil {
    format(...data: unknown[]): string;
    inspect(value: unknown, options?: object): string;
}

interface NodePath {
    dirname(path: string): string;
}

function nodeProcess(): NodeProcess {
    return process as unknown as NodeProcess;
}

let sharedPlatform: Platform | undefined;

export function nodePlatform(): Platform {
    return sharedPlatform ??= createNodePlatform();
}

function createNodePlatform(): Platform {
    return {
        files: createNodeFiles(),
        inflate: nodeInflate,
        workers: createNodeWorkers(),
        hardwareConcurrency,
        requestedRasterWorkers,
        now: () => performance.now(),
        onExit,
    };
}

function createNodeFiles(): FileSource {
    const fs = (): NodeFs => require("fs") as NodeFs;
    return {
        readBytes(path: string): Uint8Array {
            const buffer = fs().readFileSync(path);
            return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        },
        readText(path: string): string {
            return fs().readFileSync(path, "utf8");
        },
        exists(path: string): boolean {
            return fs().existsSync(path);
        },
        stat(path: string) {
            const stats = fs().statSync(path);
            return {size: stats.size, mtimeMs: stats.mtimeMs};
        },
        write(path: string, bytes: Uint8Array): void {
            fs().writeFileSync(path, bytes);
        },
    };
}

function nodeInflate(bytes: Uint8Array): Uint8Array {
    const inflated = (require("zlib") as NodeZlib).inflateSync(bytes);
    return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
}

export function nodeDeflate(bytes: Uint8Array): Uint8Array {
    return new Uint8Array((require("zlib") as NodeZlib).deflateSync(bytes));
}

const NODE_WORKER_BOOTSTRAP = `
{
    const host = require("worker_threads");
    ${WORKER_ENTRY_POINT}(host.workerData, {
        postMessage: (message, transfer) => host.parentPort.postMessage(message, transfer),
        onMessage: (callback) => host.parentPort.on("message", callback),
    });
}
`;

function createNodeWorkers(): WorkerFactory {
    return {
        spawn(source: string, data: unknown) {
            const {Worker} = require("worker_threads") as NodeWorkerThreads;
            const worker = new Worker(source + NODE_WORKER_BOOTSTRAP, {eval: true, workerData: data});
            return {
                postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void {
                    worker.postMessage(message, transfer);
                },
                onMessage(callback: (message: unknown) => void): void {
                    worker.on("message", callback);
                },
                onError(callback: (error: unknown) => void): void {
                    worker.on("error", callback);
                },
                terminate(): void {
                    void worker.terminate();
                },
                unref(): void {
                    worker.unref();
                },
            };
        },
    };
}

function hardwareConcurrency(): number {
    try {
        const os = require("os") as NodeOs;
        return os.availableParallelism?.() ?? os.cpus().length;
    } catch {
        return 1;
    }
}

function requestedRasterWorkers(): number | undefined {
    const requested = nodeProcess().env.JSENGINE_RASTER_THREADS;
    if (requested === undefined) return undefined;
    const parsed = Number.parseInt(requested, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function onExit(callback: () => void): () => void {
    const host = nodeProcess();
    host.once("exit", callback);
    host.once("SIGTERM", callback);
    return () => {
        host.removeListener("exit", callback);
        host.removeListener("SIGTERM", callback);
    };
}

export interface AppendStream {
    write(text: string): void;
    end(): void;
}

export interface NodeLogHost {
    format(...data: unknown[]): string;
    inspect(value: unknown, options?: object): string;
    openAppendStream(path: string, truncate: boolean): AppendStream;
}

let sharedLogHost: NodeLogHost | undefined;

export function nodeLogHost(): NodeLogHost {
    return sharedLogHost ??= createNodeLogHost();
}

function createNodeLogHost(): NodeLogHost {
    const util = require("util") as NodeUtil;
    const fs = require("fs") as NodeFs;
    const path = require("path") as NodePath;
    return {
        format: (...data: unknown[]) => util.format(...data),
        inspect: (value: unknown, options?: object) => util.inspect(value, options),
        openAppendStream(filePath: string, truncate: boolean): AppendStream {
            fs.mkdirSync(path.dirname(filePath), {recursive: true});
            return fs.createWriteStream(filePath, {flags: truncate ? "w" : "a"});
        },
    };
}
