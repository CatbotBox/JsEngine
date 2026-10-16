import type {FileSource, Platform, TerminalSize} from "./platform";
import type {InitMessage, PageToWorldMessage, WorldToPageMessage} from "./worldWorkerProtocol";
import {isPageToWorldMessage} from "./worldWorkerProtocol";
import {browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorkerHost} from "./browserWorkers";
import {inflate} from "../rendering/3d/image/inflate";

/** What a dedicated worker's global scope (`self`) offers the world running in it. */
export interface WorldWorkerScope extends BrowserWorkerHost {
    postMessage(message: WorldToPageMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    readonly navigator?: {readonly hardwareConcurrency?: number};
}

/**
 * Output messages the page may hold unparsed before `output.backlogged()` reports true. Two keeps
 * one frame queued while the terminal parses the previous one.
 */
const MAX_OUTPUT_IN_FLIGHT = 2;

/**
 * The world worker's end of the page connection, and the Platform built on it. Output is batched:
 * every write during one task is posted as a single `output` message when the task ends (a
 * microtask), so a frame always arrives whole and in one piece. Input, resizes and pagehide
 * arrive as messages; the size is the last one the page reported. Files are the caller's (a
 * PreloadedFileSource the worker fills), inflate is the hand-written one, and raster workers are
 * nested Web Workers only where this worker is cross-origin isolated.
 */
export class PageConnection {
    public readonly platform: Platform;

    private size: TerminalSize;
    private reader: ((data: string) => void) | undefined;
    private readonly resizeListeners = new Set<() => void>();
    private readonly exitCallbacks = new Set<() => void>();
    private pendingOutput = "";
    private flushQueued = false;
    private outputInFlight = 0;

    private constructor(private readonly scope: WorldWorkerScope, init: InitMessage, files: FileSource) {
        this.size = {columns: init.columns, rows: init.rows};
        const requestedRasterWorkers = init.requestedRasterWorkers;
        this.platform = {
            output: {
                write: chunk => this.write(chunk),
                backlogged: () => this.outputInFlight >= MAX_OUTPUT_IN_FLIGHT,
            },
            input: {
                available: () => true,
                start: onData => {
                    this.reader = onData;
                },
                stop: () => {
                    this.reader = undefined;
                },
            },
            screen: {
                size: () => this.size,
                onResize: callback => {
                    const listener = () => callback();
                    this.resizeListeners.add(listener);
                    return () => {
                        this.resizeListeners.delete(listener);
                    };
                },
            },
            files,
            inflate,
            workers: browserWorkersIfIsolated(scope),
            hardwareConcurrency: () => scope.navigator?.hardwareConcurrency ?? 1,
            requestedRasterWorkers: () => requestedRasterWorkers,
            now: () => performance.now(),
            onExit: callback => {
                const entry = () => callback();
                this.exitCallbacks.add(entry);
                return () => {
                    this.exitCallbacks.delete(entry);
                };
            },
        };
    }

    /**
     * Resolves once the page's `init` arrives, so the size is known before any world exists. Input
     * before the world starts reading it is dropped, as a terminal nobody listens to drops it.
     */
    public static open(scope: WorldWorkerScope, files: FileSource): Promise<PageConnection> {
        return new Promise(resolve => {
            let connection: PageConnection | undefined;
            scope.addEventListener("message", event => {
                const message = event.data;
                if (!isPageToWorldMessage(message)) return;
                if (connection !== undefined) connection.receive(message);
                else if (message.type === "init") resolve(connection = new PageConnection(scope, message, files));
            });
        });
    }

    /** Tells the page the user stopped the world, after everything it wrote. */
    public quit(): void {
        this.post({type: "quit"});
    }

    /** Tells the page the world failed, after everything it wrote. */
    public fail(error: unknown): void {
        this.post({type: "error", message: error instanceof Error ? error.message : String(error)});
    }

    /** Posts what was written so far now rather than at the end of the task. */
    public flush(): void {
        if (this.pendingOutput.length === 0) return;
        const data = this.pendingOutput;
        this.pendingOutput = "";
        this.outputInFlight++;
        this.scope.postMessage({type: "output", data});
    }

    private post(message: WorldToPageMessage): void {
        this.flush();
        this.scope.postMessage(message);
    }

    private write(chunk: string): void {
        if (chunk.length === 0) return;
        this.pendingOutput += chunk;
        if (this.flushQueued) return;
        this.flushQueued = true;
        queueMicrotask(() => {
            this.flushQueued = false;
            this.flush();
        });
    }

    private receive(message: PageToWorldMessage): void {
        switch (message.type) {
            case "input":
                this.reader?.(message.data);
                break;
            case "resize":
                this.size = {columns: message.columns, rows: message.rows};
                for (const listener of [...this.resizeListeners]) listener();
                break;
            case "written":
                this.outputInFlight = Math.max(0, this.outputInFlight - 1);
                break;
            case "exit": {
                const callbacks = [...this.exitCallbacks];
                this.exitCallbacks.clear();
                for (const callback of callbacks) callback();
                break;
            }
            case "init":
                break;
        }
    }
}
