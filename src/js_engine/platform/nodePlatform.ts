import type {FileSource, Platform, PlatformInput, PlatformScreen, TerminalSize, WorkerFactory} from "./platform";
import {WORKER_ENTRY_POINT} from "./platform";

/*
 * The only engine module that touches node's API. Modules are required inside function
 * bodies, never at load time, so importing this file costs nothing on a host without them.
 *
 * Node is reached through the Node* interfaces below, which list exactly what is used,
 * rather than through @types/node: World imports this file, and scriptc typechecks it
 * against narrower node typings that lack half of these members, which would stop its
 * analysis of the whole engine before it starts.
 */

interface NodeTtyReadStream {
    readonly isTTY?: boolean;
    setRawMode(raw: boolean): void;
    setEncoding(encoding: "utf8"): void;
    resume(): void;
    pause(): void;
    on(event: "data", listener: (chunk: string) => void): void;
    removeListener(event: "data", listener: (chunk: string) => void): void;
}

interface NodeTtyWriteStream {
    readonly isTTY?: boolean;
    readonly columns: number;
    readonly rows: number;
    write(chunk: string): unknown;
    on(event: "resize", listener: () => void): void;
    removeListener(event: "resize", listener: () => void): void;
    _refreshSize?(): void;
}

interface NodeProcess {
    readonly stdin: NodeTtyReadStream;
    readonly stdout: NodeTtyWriteStream;
    readonly stderr: NodeTtyWriteStream;
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

const FALLBACK_SIZE: TerminalSize = {columns: 80, rows: 24};
/** bun emits no tty resize event, so its size is polled at this interval instead. */
const BUN_RESIZE_POLL_MS = 50;

let sharedPlatform: Platform | undefined;

/** Node or bun with a terminal on stdin/stdout. One per process: they share a single stdin and stdout. */
export function nodePlatform(): Platform {
    return sharedPlatform ??= createNodePlatform();
}

function createNodePlatform(): Platform {
    const onBun = typeof (globalThis as {Bun?: unknown}).Bun !== "undefined";
    return {
        output: {
            write(chunk: string): void {
                nodeProcess().stdout.write(chunk);
            },
        },
        input: createTerminalInput(),
        screen: createTerminalScreen(onBun),
        files: createNodeFiles(),
        inflate: nodeInflate,
        workers: createNodeWorkers(),
        hardwareConcurrency,
        requestedRasterWorkers,
        now: () => performance.now(),
        onExit,
    };
}

function createTerminalInput(): PlatformInput {
    let listener: ((chunk: string) => void) | undefined;
    const stop = (): void => {
        if (listener === undefined) return;
        const stdin = nodeProcess().stdin;
        stdin.removeListener("data", listener);
        listener = undefined;
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
    };
    return {
        available: () => nodeProcess().stdin.isTTY === true,
        start(onData: (data: string) => void): void {
            stop();
            const stdin = nodeProcess().stdin;
            // setEncoding("utf8") makes every chunk a string, split multi-byte characters included.
            listener = chunk => onData(String(chunk));
            // Raw mode: byte by byte, no echo, and no automatic SIGINT on Ctrl+C.
            if (stdin.isTTY) stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding("utf8");
            stdin.on("data", listener);
        },
        stop,
    };
}

function createTerminalScreen(onBun: boolean): PlatformScreen {
    const size = (): TerminalSize => {
        const {stdout, stderr, env} = nodeProcess();
        // bun's tty stream keeps stale columns/rows after a resize unless asked to re-query.
        if (onBun) stdout._refreshSize?.();
        if (stdout?.isTTY) return {columns: stdout.columns, rows: stdout.rows};
        if (stderr?.isTTY) return {columns: stderr.columns, rows: stderr.rows};
        const columns = Number(env.COLUMNS);
        const rows = Number(env.LINES || env.ROWS);
        return {
            columns: Number.isFinite(columns) ? columns : FALLBACK_SIZE.columns,
            rows: Number.isFinite(rows) ? rows : FALLBACK_SIZE.rows,
        };
    };

    const onResize = (callback: () => void): () => void => {
        if (onBun) {
            let last = size();
            const timer = setInterval(() => {
                const next = size();
                if (next.columns === last.columns && next.rows === last.rows) return;
                last = next;
                callback();
            }, BUN_RESIZE_POLL_MS);
            (timer as {unref?: () => void}).unref?.();
            return () => clearInterval(timer);
        }
        const stdout = nodeProcess().stdout;
        if (!stdout.isTTY) return () => {};
        stdout.on("resize", callback);
        return () => {
            stdout.removeListener("resize", callback);
        };
    };

    return {size, onResize};
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

/** zlib deflate, for tools that write PNGs (`encodePng`); no running engine path compresses anything. */
export function nodeDeflate(bytes: Uint8Array): Uint8Array {
    return new Uint8Array((require("zlib") as NodeZlib).deflateSync(bytes));
}

/** Appended to every worker script: hands worker_threads' data and parent port to the entry point. */
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

/** What the opt-in file logger needs from node. Not part of Platform: no other host has a log directory. */
export interface NodeLogHost {
    format(...data: unknown[]): string;
    inspect(value: unknown, options?: object): string;
    /** Creates the file's directory if needed; `truncate` empties an existing file first. */
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
