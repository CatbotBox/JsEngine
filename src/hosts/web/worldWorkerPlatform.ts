import type {FileSource, Platform} from "../../engine/platform/platform";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import {cellFrameBuffers, copyCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {PixelPresenter} from "../../backends/pixels/pixelPresenter";
import {copyPixelFrame, pixelFrameBuffers} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {InputEventSink} from "../../engine/input";
import type {CellSurfaceSize, InitMessage, PageToWorldMessage, PixelSurfaceSize, RenderBackend, SurfaceSize, WorldToPageMessage} from "./worldWorkerProtocol";
import {isPageToWorldMessage} from "./worldWorkerProtocol";
import {browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorkerHost} from "./browserWorkers";
import {inflate} from "../../engine/assets/image/inflate";

export interface WorldWorkerScope extends BrowserWorkerHost {
    postMessage(message: WorldToPageMessage, transfer?: ArrayBuffer[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    readonly navigator?: {readonly hardwareConcurrency?: number};
}

const MAX_FRAMES_IN_FLIGHT = 2;

function surfaceMismatch(surface: SurfaceSize, wanted: RenderBackend): Error {
    return new Error(`The page shows a ${surface.kind} surface, so this world cannot present ${wanted}: `
        + `a ${wanted} world needs the page opened with ?backend=${wanted}`);
}

export class PageConnection {
    public readonly platform: Platform;

    private surface: SurfaceSize;
    private cells: CellPresenter | undefined;
    private pixels: PixelPresenter | undefined;
    private inputSink: InputEventSink | undefined;
    private readonly resizeListeners = new Set<() => void>();
    private readonly exitCallbacks = new Set<() => void>();
    private framesInFlight = 0;

    private constructor(private readonly scope: WorldWorkerScope, init: InitMessage, files: FileSource) {
        this.surface = init.surface;
        const requestedRasterWorkers = init.requestedRasterWorkers;
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

    public cellPresenter(): CellPresenter {
        this.cellSurface();
        return this.cells ??= {
            size: () => {
                const {columns, rows} = this.cellSurface();
                return {columns, rows};
            },
            onResize: listener => this.watchResize(listener),
            backlogged: () => this.backlogged(),
            start: () => {},
            stop: () => {},
            present: frame => this.postCellFrame(frame),
        };
    }

    public pixelPresenter(): PixelPresenter {
        this.pixelSurface();
        return this.pixels ??= {
            size: () => {
                const {widthPx, heightPx} = this.pixelSurface();
                return {widthPx, heightPx};
            },
            onResize: listener => this.watchResize(listener),
            backlogged: () => this.backlogged(),
            start: () => {},
            stop: () => {},
            present: frame => this.postPixelFrame(frame),
        };
    }

    public connectInput(sink: InputEventSink): () => void {
        this.inputSink = sink;
        return () => {
            if (this.inputSink === sink) this.inputSink = undefined;
        };
    }

    public showStatus(text: string): void {
        this.scope.postMessage({type: "status", text});
    }

    public quit(): void {
        this.scope.postMessage({type: "quit"});
    }

    public fail(error: unknown): void {
        this.scope.postMessage({type: "error", message: error instanceof Error ? error.message : String(error)});
    }

    private cellSurface(): CellSurfaceSize {
        const surface = this.surface;
        if (surface.kind !== "cells") throw surfaceMismatch(surface, "cells");
        return surface;
    }

    private pixelSurface(): PixelSurfaceSize {
        const surface = this.surface;
        if (surface.kind !== "pixels") throw surfaceMismatch(surface, "pixels");
        return surface;
    }

    private watchResize(listener: () => void): () => void {
        const entry = () => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    private backlogged(): boolean {
        return this.framesInFlight >= MAX_FRAMES_IN_FLIGHT;
    }

    private postCellFrame(frame: CellFrame): void {
        const copy = copyCellFrame(frame);
        this.framesInFlight++;
        this.scope.postMessage({type: "frame", frame: copy}, cellFrameBuffers(copy));
    }

    private postPixelFrame(frame: PixelFrame): void {
        const copy = copyPixelFrame(frame);
        this.framesInFlight++;
        this.scope.postMessage({type: "pixelFrame", frame: copy}, pixelFrameBuffers(copy));
    }

    private receive(message: PageToWorldMessage): void {
        switch (message.type) {
            case "inputEvents": {
                const sink = this.inputSink;
                if (sink !== undefined) for (const event of message.events) sink.enqueue(event);
                break;
            }
            case "resize":
                if (message.surface.kind !== this.surface.kind) break;
                this.surface = message.surface;
                for (const listener of [...this.resizeListeners]) listener();
                break;
            case "presented":
                this.framesInFlight = Math.max(0, this.framesInFlight - 1);
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
