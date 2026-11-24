import {cellFrameBuffers, copyCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import type {GpuCanvasPresenterFactory} from "../../backends/gpu/gpuCanvasPixelPresenter";
import {pixelFrameBuffers} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelPresenter, PixelPresenterSize} from "../../backends/pixels/pixelPresenter";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {PixelFrameBufferPool} from "../../hosts/web/pixelFrameBufferPool";
import type {CellSurfaceSize, SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {SceneViewPresenter} from "../world/editorViews";
import {isSceneViewPageMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewPageMessage, SceneViewWorkerMessage} from "./sceneViewProtocol";

export interface SceneViewScope {
    postMessage(message: SceneViewWorkerMessage, transfer?: ArrayBuffer[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface SceneViewHost {
    readonly backend: RenderBackendKind;
    readonly canvasPresenter?: GpuCanvasPresenterFactory;
    show(view: SceneViewPresenter): void;
}

const MAX_FRAMES_IN_FLIGHT = 2;
const NO_FRAMES_IN_FLIGHT = 0;
const NO_SCREEN_UNIT = 0;
const GPU_BACKEND: RenderBackendKind = "gpu";

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function surfaceMismatch(surface: SurfaceSize, backend: RenderBackendKind): Error {
    return new Error(`The Scene view shows a ${surface.kind} surface, so this ${backend} world cannot draw into it`);
}

function canvasMissing(): Error {
    return new Error(`The Scene view sent no canvas, so this ${GPU_BACKEND} world cannot draw into it`);
}

function sizeMismatch(wanted: SurfaceSize["kind"]): Error {
    return new Error(`The Scene view is not a ${wanted} surface`);
}

export class SceneViewChannel {
    private surface: SurfaceSize | undefined;
    private canvas: OffscreenCanvas | undefined;
    private host: SceneViewHost | undefined;
    private opened = false;
    private framesInFlight = NO_FRAMES_IN_FLIGHT;
    private shownScreenUnitX = NO_SCREEN_UNIT;
    private shownScreenUnitY = NO_SCREEN_UNIT;
    private readonly resizeListeners = new Set<() => void>();
    private readonly returnedPixelBuffers = new PixelFrameBufferPool(MAX_FRAMES_IN_FLIGHT);

    public constructor(private readonly scope: SceneViewScope) {
        scope.addEventListener("message", event => {
            if (isSceneViewPageMessage(event.data)) this.receive(event.data);
        });
    }

    public attach(host: SceneViewHost): void {
        this.host = host;
        this.openWhenRequested();
    }

    private receive(message: SceneViewPageMessage): void {
        switch (message.kind) {
            case "open":
                if (this.surface !== undefined) return;
                this.surface = message.surface;
                this.canvas = message.canvas;
                this.openWhenRequested();
                break;
            case "resize":
                if (this.surface === undefined || message.surface.kind !== this.surface.kind) return;
                this.surface = message.surface;
                for (const listener of [...this.resizeListeners]) listener();
                break;
            case "presented":
                this.framesInFlight = Math.max(NO_FRAMES_IN_FLIGHT, this.framesInFlight - 1);
                if (message.returnedBuffer !== undefined) this.returnedPixelBuffers.give(message.returnedBuffer);
                break;
        }
    }

    private openWhenRequested(): void {
        const host = this.host, surface = this.surface;
        if (host === undefined || surface === undefined || this.opened) return;
        this.opened = true;
        try {
            host.show(this.presenterFor(host, surface));
        } catch (error) {
            this.post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "error", message: errorText(error)});
        }
    }

    private presenterFor(host: SceneViewHost, surface: SurfaceSize): SceneViewPresenter {
        if (host.backend === GPU_BACKEND) {
            const canvas = this.canvas;
            if (canvas === undefined || host.canvasPresenter === undefined) throw canvasMissing();
            const pixelSurface = {size: () => this.pixelSize(), onResize: (listener: () => void) => this.watchResize(listener)};
            return {kind: "pixels", presenter: host.canvasPresenter(canvas, pixelSurface, (x, y) => this.showScreenUnit(x, y))};
        }
        if (surface.kind !== host.backend) throw surfaceMismatch(surface, host.backend);
        return surface.kind === "cells" ? {kind: "cells", presenter: this.cellPresenter()} : {kind: "pixels", presenter: this.pixelPresenter()};
    }

    private cellPresenter(): CellPresenter {
        return {
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

    private pixelPresenter(): PixelPresenter {
        return {
            size: () => this.pixelSize(),
            onResize: listener => this.watchResize(listener),
            backlogged: () => this.backlogged(),
            start: () => {},
            stop: () => {},
            present: frame => this.postPixelFrame(frame),
        };
    }

    private cellSurface(): CellSurfaceSize {
        const surface = this.surface;
        if (surface?.kind !== "cells") throw sizeMismatch("cells");
        return surface;
    }

    private pixelSize(): PixelPresenterSize {
        const surface = this.surface;
        if (surface?.kind !== "pixels") throw sizeMismatch("pixels");
        return {widthPx: surface.widthPx, heightPx: surface.heightPx};
    }

    private watchResize(listener: () => void): () => void {
        const entry = (): void => listener();
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
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "frame", frame: copy}, cellFrameBuffers(copy));
    }

    private postPixelFrame(frame: PixelFrame): void {
        const copy = this.returnedPixelBuffers.copy(frame);
        this.framesInFlight++;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "pixelFrame", frame: copy}, pixelFrameBuffers(copy));
    }

    private showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        if (pixelsPerScreenUnitX === this.shownScreenUnitX && pixelsPerScreenUnitY === this.shownScreenUnitY) return;
        this.shownScreenUnitX = pixelsPerScreenUnitX;
        this.shownScreenUnitY = pixelsPerScreenUnitY;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, kind: "screenUnit", pixelsPerScreenUnitX, pixelsPerScreenUnitY});
    }

    private post(message: SceneViewWorkerMessage, transfer: ArrayBuffer[] = []): void {
        this.scope.postMessage(message, transfer);
    }
}
