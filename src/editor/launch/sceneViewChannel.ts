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
import type {SceneViewId} from "../project/dockPanelIds";
import type {SceneViewPresenter} from "../world/editorViews";
import {isSceneViewPageMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewOpenMessage, SceneViewPageMessage, SceneViewWorkerMessage} from "./sceneViewProtocol";

export interface SceneViewScope {
    postMessage(message: SceneViewWorkerMessage, transfer?: ArrayBuffer[]): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface SceneViewHost {
    readonly backend: RenderBackendKind;
    readonly canvasPresenter?: GpuCanvasPresenterFactory;
    open(view: SceneViewId, presenter: SceneViewPresenter): void;
    close(view: SceneViewId): void;
}

const MAX_FRAMES_IN_FLIGHT = 2;
const NO_FRAMES_IN_FLIGHT = 0;
const NO_FRAMES_PRESENTED = 0;
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

class SceneViewEndpoint {
    private surface: SurfaceSize;
    private readonly canvas: OffscreenCanvas | undefined;
    private presenter: SceneViewPresenter | undefined;
    private opened = false;
    private framesInFlight = NO_FRAMES_IN_FLIGHT;
    private presentedFrames = NO_FRAMES_PRESENTED;
    private shownScreenUnitX = NO_SCREEN_UNIT;
    private shownScreenUnitY = NO_SCREEN_UNIT;
    private readonly resizeListeners = new Set<() => void>();
    private readonly returnedPixelBuffers = new PixelFrameBufferPool(MAX_FRAMES_IN_FLIGHT);

    public constructor(public readonly view: SceneViewId, open: SceneViewOpenMessage, private readonly scope: SceneViewScope) {
        this.surface = open.surface;
        this.canvas = open.canvas;
    }

    public open(host: SceneViewHost): void {
        if (this.opened) return;
        this.opened = true;
        try {
            const presenter = this.presenterFor(host);
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
    }

    public close(host: SceneViewHost | undefined): void {
        const presenter = this.presenter;
        this.presenter = undefined;
        this.resizeListeners.clear();
        if (presenter === undefined) return;
        host?.close(this.view);
        presenter.presenter.dispose?.();
    }

    private presenterFor(host: SceneViewHost): SceneViewPresenter {
        const presentedFrames = (): number => this.presentedFrames;
        const surface = this.surface;
        if (host.backend === GPU_BACKEND) {
            const canvas = this.canvas;
            if (canvas === undefined || host.canvasPresenter === undefined) throw canvasMissing();
            const pixelSurface = {size: () => this.pixelSize(), onResize: (listener: () => void) => this.watchResize(listener)};
            return {kind: "pixels", presenter: host.canvasPresenter(canvas, pixelSurface, (x, y) => this.canvasFramePresented(x, y)), presentedFrames};
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

    private backlogged(): boolean {
        return this.framesInFlight >= MAX_FRAMES_IN_FLIGHT;
    }

    private postCellFrame(frame: CellFrame): void {
        const copy = copyCellFrame(frame);
        this.framesInFlight++;
        this.presentedFrames++;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "frame", frame: copy}, cellFrameBuffers(copy));
    }

    private postPixelFrame(frame: PixelFrame): void {
        const copy = this.returnedPixelBuffers.copy(frame);
        this.framesInFlight++;
        this.presentedFrames++;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "pixelFrame", frame: copy}, pixelFrameBuffers(copy));
    }

    private canvasFramePresented(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        this.presentedFrames++;
        if (pixelsPerScreenUnitX === this.shownScreenUnitX && pixelsPerScreenUnitY === this.shownScreenUnitY) return;
        this.shownScreenUnitX = pixelsPerScreenUnitX;
        this.shownScreenUnitY = pixelsPerScreenUnitY;
        this.post({type: SCENE_VIEW_MESSAGE_TYPE, view: this.view, kind: "screenUnit", pixelsPerScreenUnitX, pixelsPerScreenUnitY});
    }

    private post(message: SceneViewWorkerMessage, transfer: ArrayBuffer[] = []): void {
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
