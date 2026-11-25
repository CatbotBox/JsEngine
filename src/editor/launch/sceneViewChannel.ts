import {cellFrameBuffers, copyCellFrame} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import type {GpuCanvasPresenterFactory} from "../../backends/gpu/gpuCanvasPixelPresenter";
import {pixelFrameBuffers} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelPresenter, PixelPresenterSize} from "../../backends/pixels/pixelPresenter";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {bitmapFrameTransfers} from "../../hosts/web/bitmapFrame";
import type {BitmapFrame} from "../../hosts/web/bitmapFrame";
import {PixelFrameBufferPool} from "../../hosts/web/pixelFrameBufferPool";
import type {CellSurfaceSize, SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {EditorViewInfo} from "../editorProtocol";
import type {SceneViewId} from "../project/dockPanelIds";
import type {SceneViewPresenter} from "../world/editorViews";
import {isSceneViewPageMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewOpenMessage, SceneViewPageMessage, SceneViewWorkerMessage} from "./sceneViewProtocol";

export type SceneViewTransferable = ArrayBuffer | ImageBitmap;

export interface SceneViewScope {
    postMessage(message: SceneViewWorkerMessage, transfer?: SceneViewTransferable[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface SceneViewHost {
    readonly backend: RenderBackendKind;
    readonly canvasPresenter?: GpuCanvasPresenterFactory;
    open(view: SceneViewId, presenter: SceneViewPresenter): void;
    close(view: SceneViewId): void;
    frameInfo(view: SceneViewId): EditorViewInfo | undefined;
}

const MAX_FRAMES_IN_FLIGHT = 2;
const MAX_BITMAPS_IN_FLIGHT = 1;
const NO_FRAMES_IN_FLIGHT = 0;
const NO_FRAMES_PRESENTED = 0;
const MIN_CANVAS_PX = 1;
const GPU_BACKEND: RenderBackendKind = "gpu";

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function surfaceMismatch(surface: SurfaceSize, backend: RenderBackendKind): Error {
    return new Error(`The Scene view shows a ${surface.kind} surface, so this ${backend} world cannot draw into it`);
}

function canvasPresenterMissing(): Error {
    return new Error(`This ${GPU_BACKEND} world has no canvas presenter, so it cannot draw the Scene view`);
}

function sizeMismatch(wanted: SurfaceSize["kind"]): Error {
    return new Error(`The Scene view is not a ${wanted} surface`);
}

class SceneViewEndpoint {
    private surface: SurfaceSize;
    private canvas: OffscreenCanvas | undefined;
    private presenter: SceneViewPresenter | undefined;
    private host: SceneViewHost | undefined;
    private opened = false;
    private framesInFlight = NO_FRAMES_IN_FLIGHT;
    private maxFramesInFlight = MAX_FRAMES_IN_FLIGHT;
    private presentedFrames = NO_FRAMES_PRESENTED;
    private readonly resizeListeners = new Set<() => void>();
    private readonly presentedListeners = new Set<() => void>();
    private readonly returnedPixelBuffers = new PixelFrameBufferPool(MAX_FRAMES_IN_FLIGHT);

    public constructor(public readonly view: SceneViewId, open: SceneViewOpenMessage, private readonly scope: SceneViewScope) {
        this.surface = open.surface;
    }

    public open(host: SceneViewHost): void {
        if (this.opened) return;
        this.opened = true;
        try {
            const presenter = this.presenterFor(host);
            this.host = host;
            host.open(this.view, presenter);
            this.presenter = presenter;
        } catch (error) {
            this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "error", message: errorText(error)});
        }
    }

    public resize(surface: SurfaceSize): void {
        if (surface.kind !== this.surface.kind) return;
        this.surface = surface;
        for (const listener of [...this.resizeListeners]) listener();
    }

    public presented(returnedBuffer: ArrayBuffer | undefined): void {
        this.framesInFlight = Math.max(NO_FRAMES_IN_FLIGHT, this.framesInFlight - 1);
        if (returnedBuffer !== undefined) this.returnedPixelBuffers.give(returnedBuffer);
        for (const listener of [...this.presentedListeners]) listener();
    }

    public close(host: SceneViewHost | undefined): void {
        const presenter = this.presenter;
        this.presenter = undefined;
        this.host = undefined;
        this.canvas = undefined;
        this.resizeListeners.clear();
        this.presentedListeners.clear();
        if (presenter === undefined) return;
        host?.close(this.view);
        presenter.presenter.dispose?.();
    }

    private presenterFor(host: SceneViewHost): SceneViewPresenter {
        const presentedFrames = (): number => this.presentedFrames;
        const surface = this.surface;
        if (host.backend === GPU_BACKEND) {
            const canvasPresenter = host.canvasPresenter;
            if (canvasPresenter === undefined) throw canvasPresenterMissing();
            if (surface.kind !== "pixels") throw surfaceMismatch(surface, host.backend);
            const canvas = new OffscreenCanvas(Math.max(MIN_CANVAS_PX, surface.widthPx), Math.max(MIN_CANVAS_PX, surface.heightPx));
            const canvasSurface = {
                size: () => this.pixelSize(),
                onResize: (listener: () => void) => this.watchResize(listener),
                backlogged: () => this.backlogged(),
                onPresented: (listener: () => void) => this.watchPresented(listener),
            };
            const presenter = canvasPresenter(canvas, canvasSurface, (x, y) => this.canvasFramePresented(x, y));
            this.canvas = canvas;
            this.maxFramesInFlight = MAX_BITMAPS_IN_FLIGHT;
            return {kind: "pixels", presenter, presentedFrames};
        }
        if (surface.kind !== host.backend) throw surfaceMismatch(surface, host.backend);
        return surface.kind === "cells" ? {kind: "cells", presenter: this.cellPresenter(), presentedFrames} : {kind: "pixels", presenter: this.pixelPresenter(), presentedFrames};
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
        if (surface.kind !== "cells") throw sizeMismatch("cells");
        return surface;
    }

    private pixelSize(): PixelPresenterSize {
        const surface = this.surface;
        if (surface.kind !== "pixels") throw sizeMismatch("pixels");
        return {widthPx: surface.widthPx, heightPx: surface.heightPx};
    }

    private watchResize(listener: () => void): () => void {
        const entry = (): void => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    private watchPresented(listener: () => void): () => void {
        const entry = (): void => listener();
        this.presentedListeners.add(entry);
        return () => {
            this.presentedListeners.delete(entry);
        };
    }

    private backlogged(): boolean {
        return this.framesInFlight >= this.maxFramesInFlight;
    }

    private frameInfoField(): {readonly info?: EditorViewInfo} {
        const info = this.host?.frameInfo(this.view);
        return info === undefined ? {} : {info};
    }

    private postCellFrame(frame: CellFrame): void {
        const copy = copyCellFrame(frame);
        this.framesInFlight++;
        this.presentedFrames++;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "frame", frame: copy, ...this.frameInfoField()}, cellFrameBuffers(copy));
    }

    private postPixelFrame(frame: PixelFrame): void {
        const copy = this.returnedPixelBuffers.copy(frame);
        this.framesInFlight++;
        this.presentedFrames++;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "pixelFrame", frame: copy, ...this.frameInfoField()}, pixelFrameBuffers(copy));
    }

    private canvasFramePresented(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        const canvas = this.canvas;
        if (canvas === undefined) return;
        const frame: BitmapFrame = {bitmap: canvas.transferToImageBitmap(), pixelsPerScreenUnitX, pixelsPerScreenUnitY};
        this.framesInFlight++;
        this.presentedFrames++;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "bitmapFrame", frame, ...this.frameInfoField()}, bitmapFrameTransfers(frame));
    }

    private post(message: SceneViewWorkerMessage, transfer: SceneViewTransferable[] = []): void {
        this.scope.postMessage(message, transfer);
    }
}

export class SceneViewChannel {
    private host: SceneViewHost | undefined;
    private readonly endpoints = new Map<SceneViewId, SceneViewEndpoint>();

    public constructor(private readonly scope: SceneViewScope) {
        scope.addEventListener("message", event => {
            if (isSceneViewPageMessage(event.data)) this.receive(event.data);
        });
    }

    public attach(host: SceneViewHost): void {
        this.host = host;
        for (const endpoint of this.endpoints.values()) endpoint.open(host);
    }

    private receive(message: SceneViewPageMessage): void {
        const view = message.view;
        switch (message.kind) {
            case "open": {
                if (this.endpoints.has(view)) return;
                const endpoint = new SceneViewEndpoint(view, message, this.scope);
                this.endpoints.set(view, endpoint);
                if (this.host !== undefined) endpoint.open(this.host);
                break;
            }
            case "resize":
                this.endpoints.get(view)?.resize(message.surface);
                break;
            case "presented":
                this.endpoints.get(view)?.presented(message.returnedBuffer);
                break;
            case "close": {
                const endpoint = this.endpoints.get(view);
                if (endpoint === undefined) return;
                this.endpoints.delete(view);
                endpoint.close(this.host);
                break;
            }
        }
    }
}
