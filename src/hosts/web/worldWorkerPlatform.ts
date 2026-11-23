import type {FileSource, Platform} from "../../engine/platform/platform";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import {cellFrameBuffers, copyCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {PixelPresenter} from "../../backends/pixels/pixelPresenter";
import {pixelFrameBuffers} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {InputEventSink} from "../../engine/input";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import type {CellSurfaceSize, InitMessage, PageToWorldMessage, PixelSurfaceSize, SurfaceSize, WorldToPageMessage} from "./worldWorkerProtocol";
import {isPageToWorldMessage} from "./worldWorkerProtocol";
import {browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorkerHost} from "./browserWorkers";
import {inflate} from "../../engine/assets/image/inflate";
import {PixelFrameBufferPool} from "./pixelFrameBufferPool";
import {timerFrameScheduler} from "../../engine/platform/timerFrameScheduler";
import {displayFrameScheduler} from "./animationFrameScheduler";
import type {MaybeAnimationFrameHost} from "./animationFrameScheduler";

export interface WorldWorkerScope extends BrowserWorkerHost, MaybeAnimationFrameHost {
    postMessage(message: WorldToPageMessage, transfer?: ArrayBuffer[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
    readonly navigator?: {readonly hardwareConcurrency?: number};
}

const MAX_FRAMES_IN_FLIGHT = 2;

const GPU_BACKEND: RenderBackendKind = "gpu";
const NO_SCREEN_UNIT = 0;

function surfaceMismatch(surface: SurfaceSize, wanted: RenderBackendKind): Error {
    return new Error(`The page shows a ${surface.kind} surface, so this world cannot present ${wanted}: `
        + `a ${wanted} world needs the page opened with ?backend=${wanted}`);
}

function missingCanvas(): Error {
    return new Error(`The page sent no canvas, so this world cannot present ${GPU_BACKEND}: `
        + `a ${GPU_BACKEND} world needs the page opened with ?backend=${GPU_BACKEND}`);
}

export class PageConnection {
    public readonly platform: Platform;

    private surface: SurfaceSize;
    private readonly canvas: OffscreenCanvas | undefined;
    private shownScreenUnitX = NO_SCREEN_UNIT;
    private shownScreenUnitY = NO_SCREEN_UNIT;
    private cells: CellPresenter | undefined;
    private pixels: PixelPresenter | undefined;
    private inputSink: InputEventSink | undefined;
    private readonly resizeListeners = new Set<() => void>();
    private readonly exitCallbacks = new Set<() => void>();
    private framesInFlight = 0;
    private readyReported = false;
    private readonly returnedPixelBuffers = new PixelFrameBufferPool(MAX_FRAMES_IN_FLIGHT);

    private constructor(private readonly scope: WorldWorkerScope, init: InitMessage, files: FileSource) {
        this.surface = init.surface;
        this.canvas = init.canvas;
        const requestedRasterWorkers = init.requestedRasterWorkers;
        const now = (): number => performance.now();
        const canvasDrivesDisplayFrames = init.canvas !== undefined;
        this.platform = {
            files,
            inflate,
            workers: browserWorkersIfIsolated(scope),
            hardwareConcurrency: () => scope.navigator?.hardwareConcurrency ?? 1,
            requestedRasterWorkers: () => requestedRasterWorkers,
            now,
            frameScheduler: canvasDrivesDisplayFrames ? displayFrameScheduler(scope, now) : timerFrameScheduler(now),
            onExit: callback => {
                const entry = () => callback();
                this.exitCallbacks.add(entry);
                return () => {
                    this.exitCallbacks.delete(entry);
                };
            },
            quit: () => this.quit(),
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

    public renderBackend(): RenderBackendKind {
        return this.canvas === undefined ? this.surface.kind : GPU_BACKEND;
    }

    public gpuCanvas(): OffscreenCanvas {
        if (this.canvas === undefined) throw missingCanvas();
        return this.canvas;
    }

    public showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        if (pixelsPerScreenUnitX === this.shownScreenUnitX && pixelsPerScreenUnitY === this.shownScreenUnitY) return;
        this.shownScreenUnitX = pixelsPerScreenUnitX;
        this.shownScreenUnitY = pixelsPerScreenUnitY;
        this.scope.postMessage({type: "screenUnit", pixelsPerScreenUnitX, pixelsPerScreenUnitY});
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

    public reportReady(): void {
        if (this.readyReported) return;
        this.readyReported = true;
        this.scope.postMessage({type: "ready"});
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
        const copy = this.returnedPixelBuffers.copy(frame);
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
                // A page's surface kind never changes, so a resize of the other kind is ignored.
                if (message.surface.kind !== this.surface.kind) break;
                this.surface = message.surface;
                for (const listener of [...this.resizeListeners]) listener();
                break;
            case "presented":
                this.framesInFlight = Math.max(0, this.framesInFlight - 1);
                if (message.returnedBuffer !== undefined) this.returnedPixelBuffers.give(message.returnedBuffer);
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
