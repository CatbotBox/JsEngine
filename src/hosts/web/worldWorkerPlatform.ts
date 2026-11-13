import type {FileSource, Platform} from "../../engine/platform/platform";
import type {CellSurface, CellSurfaceSize} from "../../backends/cells/cellSurface";
import type {InputEventSink} from "../../engine/input";
import type {InitMessage, PageToWorldMessage, WorldToPageMessage} from "./worldWorkerProtocol";
import {isPageToWorldMessage} from "./worldWorkerProtocol";
import {browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorkerHost} from "./browserWorkers";
import {inflate} from "../../engine/assets/image/inflate";

export interface WorldWorkerScope extends BrowserWorkerHost {
    postMessage(message: WorldToPageMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    readonly navigator?: {readonly hardwareConcurrency?: number};
}

const MAX_OUTPUT_IN_FLIGHT = 2;

export class PageConnection {
    public readonly platform: Platform;
    public readonly terminal: CellSurface;

    private size: CellSurfaceSize;
    private inputSink: InputEventSink | undefined;
    private readonly resizeListeners = new Set<() => void>();
    private readonly exitCallbacks = new Set<() => void>();
    private pendingOutput = "";
    private flushQueued = false;
    private outputInFlight = 0;

    private constructor(private readonly scope: WorldWorkerScope, init: InitMessage, files: FileSource) {
        this.size = {columns: init.columns, rows: init.rows};
        const requestedRasterWorkers = init.requestedRasterWorkers;
        this.terminal = {
            write: chunk => this.write(chunk),
            backlogged: () => this.outputInFlight >= MAX_OUTPUT_IN_FLIGHT,
            size: () => this.size,
            onResize: callback => {
                const listener = () => callback();
                this.resizeListeners.add(listener);
                return () => {
                    this.resizeListeners.delete(listener);
                };
            },
        };
        this.platform = {
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

    public connectInput(sink: InputEventSink): () => void {
        this.inputSink = sink;
        return () => {
            if (this.inputSink === sink) this.inputSink = undefined;
        };
    }

    public quit(): void {
        this.post({type: "quit"});
    }

    public fail(error: unknown): void {
        this.post({type: "error", message: error instanceof Error ? error.message : String(error)});
    }

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
            case "inputEvents": {
                const sink = this.inputSink;
                if (sink !== undefined) for (const event of message.events) sink.enqueue(event);
                break;
            }
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
