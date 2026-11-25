import {describe, expect, test} from "../../engine/testing/harness";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import type {GpuCanvasPresenterFactory, GpuCanvasPresenterSurface} from "../../backends/gpu/gpuCanvasPixelPresenter";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelPresenter} from "../../backends/pixels/pixelPresenter";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {TextColor} from "../../engine/rendering/textColor";
import type {BitmapWorldDisplay} from "../../hosts/web/bitmapCanvasDisplay";
import type {BitmapFrame} from "../../hosts/web/bitmapFrame";
import type {CellWorldDisplay, PageTransferable, PixelWorldDisplay} from "../../hosts/web/worldWorkerPage";
import {isPageToWorldMessage, isWorldToPageMessage} from "../../hosts/web/worldWorkerProtocol";
import type {CellSurfaceSize, PixelSurfaceSize, SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {EditorViewInfo} from "../editorProtocol";
import type {SceneViewPresenter} from "../world/editorViews";
import {SceneViewChannel} from "./sceneViewChannel";
import type {SceneViewScope, SceneViewTransferable} from "./sceneViewChannel";
import {connectSceneView, sceneViewFailureMessage, sceneViewMismatchMessage} from "./sceneViewConnection";
import type {SceneViewConnectionOptions} from "./sceneViewConnection";
import type {SceneViewId} from "../project/dockPanelIds";
import {isSceneViewPageMessage, isSceneViewWorkerMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewBitmapFrameMessage, SceneViewPageMessage, SceneViewWorkerMessage} from "./sceneViewProtocol";

const PIXEL_SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 4, heightPx: 2};
const RESIZED_PIXEL_SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 8, heightPx: 6};
const CELL_SURFACE: CellSurfaceSize = {kind: "cells", columns: 3, rows: 2};
const RGBA_BYTES_PER_PIXEL = 4;
const SCREEN_UNIT_X = 8;
const SCREEN_UNIT_Y = 16;
const NAME = "the demo";
const SPACE = 0x20;
const VIEW: SceneViewId = "scene";
const SECOND_VIEW: SceneViewId = "scene:2";
const SHOWN_VIEW: SceneViewConnectionOptions = {view: VIEW, name: NAME, shown: true};
const UNIT_SCREEN = 1;
const DRAWN = "drawn";

function pixelFrame(widthPx: number, heightPx: number): PixelFrame {
    return {widthPx, heightPx, rgba: new Uint8ClampedArray(widthPx * heightPx * RGBA_BYTES_PER_PIXEL), pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y};
}

function viewInfo(view: SceneViewId, presentedFrames: number): EditorViewInfo {
    return {
        view,
        projection: "orthographic",
        worldToScreen: [],
        screenWidth: UNIT_SCREEN,
        screenHeight: UNIT_SCREEN,
        camera: {position: [0, 0, 0], rotation: [0, 0, 0, 1]},
        bounds: [],
        sceneViews: [view],
        presentedFrames,
    };
}

function cellFrame(width: number, height: number): CellFrame {
    const cells = width * height;
    return {
        width, height,
        kind: new Uint8Array(cells), glyph: new Uint32Array(cells),
        foreground: new Uint32Array(cells), background: new Uint32Array(cells),
        rgb: new Int32Array(cells), rgbTop: new Int32Array(cells),
        backgroundStyle: {glyph: SPACE, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT},
    };
}

class FakeImageBitmap {
    public closed = false;

    public close(): void {
        this.closed = true;
    }
}

class FakeOffscreenCanvas {
    public readonly bitmaps: FakeImageBitmap[] = [];

    public constructor(public readonly width: number, public readonly height: number) {
    }

    public transferToImageBitmap(): FakeImageBitmap {
        const bitmap = new FakeImageBitmap();
        this.bitmaps.push(bitmap);
        return bitmap;
    }
}

type BrowserGlobals = {OffscreenCanvas?: unknown, ImageBitmap?: unknown};

function withBrowserGlobals(body: () => void): void {
    const scope = globalThis as BrowserGlobals;
    const previous: BrowserGlobals = {OffscreenCanvas: scope.OffscreenCanvas, ImageBitmap: scope.ImageBitmap};
    scope.OffscreenCanvas = FakeOffscreenCanvas;
    scope.ImageBitmap = FakeImageBitmap;
    try {
        body();
    } finally {
        for (const name of ["OffscreenCanvas", "ImageBitmap"] as const) {
            if (previous[name] === undefined) delete scope[name];
            else scope[name] = previous[name];
        }
    }
}

function bitmapFrame(): BitmapFrame {
    return {bitmap: new FakeImageBitmap() as unknown as ImageBitmap, pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y};
}

function closed(frame: BitmapFrame): boolean {
    return (frame.bitmap as unknown as FakeImageBitmap).closed;
}

interface MadeCanvasPresenter {
    readonly canvas: FakeOffscreenCanvas;
    readonly surface: GpuCanvasPresenterSurface;
    readonly presenter: PixelPresenter;
}

function canvasPresenterFactory(made: MadeCanvasPresenter[]): GpuCanvasPresenterFactory {
    return (canvas, surface, reportScreenUnit) => {
        const presenter: PixelPresenter = {
            size: surface.size,
            onResize: surface.onResize,
            backlogged: () => surface.backlogged?.() === true,
            onPresented: listener => surface.onPresented?.(listener) ?? (() => undefined),
            start: () => {},
            stop: () => {},
            present: () => reportScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y),
        };
        made.push({canvas: canvas as unknown as FakeOffscreenCanvas, surface, presenter});
        return presenter;
    };
}

class FakeWorkerScope implements SceneViewScope {
    public readonly posted: {message: SceneViewWorkerMessage, transfer: SceneViewTransferable[] | undefined}[] = [];
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public postMessage(message: SceneViewWorkerMessage, transfer?: SceneViewTransferable[]): void {
        this.posted.push({message, transfer});
    }

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.push(listener);
    }

    public send(data: unknown): void {
        for (const listener of this.listeners) listener({data});
    }

    public kinds(): string[] {
        return this.posted.map(({message}) => message.kind);
    }
}

class RecordingHost {
    public readonly shown: SceneViewPresenter[] = [];
    public readonly opened: SceneViewId[] = [];
    public readonly closed: SceneViewId[] = [];
    public reportsFrameInfo = false;

    public constructor(public readonly backend: RenderBackendKind, public readonly canvasPresenter?: GpuCanvasPresenterFactory) {
    }

    public open(view: SceneViewId, presenter: SceneViewPresenter): void {
        this.opened.push(view);
        this.shown.push(presenter);
    }

    public close(view: SceneViewId): void {
        this.closed.push(view);
    }

    public frameInfo(view: SceneViewId): EditorViewInfo | undefined {
        const presenter = this.shown[this.opened.lastIndexOf(view)];
        return this.reportsFrameInfo && presenter !== undefined ? viewInfo(view, presenter.presentedFrames()) : undefined;
    }
}

function open(surface: SurfaceSize, view: SceneViewId = VIEW): SceneViewPageMessage {
    return {type: SCENE_VIEW_MESSAGE_TYPE, view, kind: "open", surface};
}

function pixelPresenterOf(host: RecordingHost): PixelPresenter {
    const [view] = host.shown;
    if (view?.kind !== "pixels") throw new Error("no pixel presenter was shown");
    return view.presenter;
}

function cellPresenterOf(host: RecordingHost): CellPresenter {
    const [view] = host.shown;
    if (view?.kind !== "cells") throw new Error("no cell presenter was shown");
    return view.presenter;
}

describe("scene view protocol", () => {
    test("page and worker messages are recognised by their type and kind, and the world protocol ignores them", () => {
        const page: SceneViewPageMessage[] = [open(PIXEL_SURFACE), {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: CELL_SURFACE}, {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented"}];
        withBrowserGlobals(() => {
            const worker: SceneViewWorkerMessage[] = [
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame: pixelFrame(1, 1)},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame: bitmapFrame()},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "error", message: "broken"},
            ];
            expect(page.every(isSceneViewPageMessage)).toBe(true);
            expect(worker.every(isSceneViewWorkerMessage)).toBe(true);
            expect([...page, ...worker].some(message => isPageToWorldMessage(message) || isWorldToPageMessage(message))).toBe(false);
            expect(worker.some(isSceneViewPageMessage) || page.some(isSceneViewWorkerMessage)).toBe(false);
            expect(isSceneViewPageMessage({type: "resize", surface: CELL_SURFACE})).toBe(false);
            expect(isSceneViewPageMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "open", surface: {kind: "pixels", widthPx: -1, heightPx: 2}})).toBe(false);
            expect(isSceneViewWorkerMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame: {...bitmapFrame(), pixelsPerScreenUnitX: 0}})).toBe(false);
            expect(isSceneViewWorkerMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame: {bitmap: {}, pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y}})).toBe(false);
            expect(isSceneViewWorkerMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "screenUnit", pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y})).toBe(false);
        });
    });

    test("frame messages may carry their own view's info", () => {
        withBrowserGlobals(() => {
            const info = viewInfo(VIEW, 1);
            expect([
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame: pixelFrame(1, 1), info},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "frame", frame: cellFrame(1, 1), info},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame: bitmapFrame(), info},
            ].every(isSceneViewWorkerMessage)).toBe(true);
            expect([
                {type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "pixelFrame", frame: pixelFrame(1, 1), info},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "frame", frame: cellFrame(1, 1), info: null},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "bitmapFrame", frame: bitmapFrame(), info},
                {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "frameInfo", info},
            ].some(isSceneViewWorkerMessage)).toBe(false);
        });
    });
});

describe("scene view channel in the worker", () => {
    test("an open request waits for the world, then shows a pixel presenter that follows the page's surface and posts transferred frames", () => {
        const scope = new FakeWorkerScope();
        const channel = new SceneViewChannel(scope);
        scope.send(open(PIXEL_SURFACE));
        const host = new RecordingHost("pixels");
        channel.attach(host);
        const presenter = pixelPresenterOf(host);
        expect(presenter.size()).toEqual({widthPx: 4, heightPx: 2});
        let resizes = 0;
        presenter.onResize(() => resizes++);
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: RESIZED_PIXEL_SURFACE});
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: CELL_SURFACE});
        expect([resizes, presenter.size().widthPx]).toEqual([1, 8]);

        presenter.present(pixelFrame(8, 6));
        expect(presenter.backlogged?.()).toBe(false);
        presenter.present(pixelFrame(8, 6));
        expect(presenter.backlogged?.()).toBe(true);
        const [first] = scope.posted;
        expect(first.message.kind).toBe("pixelFrame");
        expect(first.transfer?.length).toBe(1);
        const returned = (first.message as {frame: PixelFrame}).frame.rgba.buffer as ArrayBuffer;
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented", returnedBuffer: returned});
        expect(presenter.backlogged?.()).toBe(false);
        presenter.present(pixelFrame(8, 6));
        expect((scope.posted[2].message as {frame: PixelFrame}).frame.rgba.buffer).toBe(returned);
        scope.send(open(CELL_SURFACE));
        expect(host.shown.length).toBe(1);
    });

    test("a cells world shows a cell presenter on a cells surface and refuses a pixels one", () => {
        const scope = new FakeWorkerScope();
        const cells = new RecordingHost("cells");
        new SceneViewChannel(scope).attach(cells);
        scope.send(open(CELL_SURFACE));
        const presenter = cellPresenterOf(cells);
        expect(presenter.size()).toEqual({columns: 3, rows: 2});
        presenter.present(cellFrame(3, 2), "full");
        expect(scope.kinds()).toEqual(["frame"]);

        const mismatched = new FakeWorkerScope();
        const pixelsWorld = new RecordingHost("pixels");
        new SceneViewChannel(mismatched).attach(pixelsWorld);
        mismatched.send(open(CELL_SURFACE));
        expect(pixelsWorld.shown.length).toBe(0);
        expect(mismatched.kinds()).toEqual(["error"]);
    });

    test("a gpu world draws into a canvas of its own, sized by the page's surface, and posts each frame as a transferred bitmap, one at a time", () => {
        withBrowserGlobals(() => {
            const scope = new FakeWorkerScope();
            const made: MadeCanvasPresenter[] = [];
            const host = new RecordingHost("gpu", canvasPresenterFactory(made));
            new SceneViewChannel(scope).attach(host);
            scope.send(open(PIXEL_SURFACE));
            const [{canvas, surface, presenter}] = made;
            expect(pixelPresenterOf(host)).toBe(presenter);
            expect([canvas.width, canvas.height, surface.size()]).toEqual([4, 2, {widthPx: 4, heightPx: 2}]);
            let acknowledgements = 0;
            presenter.onPresented?.(() => acknowledgements++);

            presenter.present(pixelFrame(4, 2));
            expect(presenter.backlogged?.()).toBe(true);
            const [posted] = scope.posted;
            const frame = (posted.message as SceneViewBitmapFrameMessage).frame;
            expect([posted.message.kind, frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY]).toEqual(["bitmapFrame", SCREEN_UNIT_X, SCREEN_UNIT_Y]);
            expect(frame.bitmap as unknown).toBe(canvas.bitmaps[0]);
            expect(posted.transfer?.[0] as unknown).toBe(canvas.bitmaps[0]);
            scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented"});
            expect([presenter.backlogged?.(), acknowledgements, host.shown[0].presentedFrames()]).toEqual([false, 1, 1]);

            const withoutPresenter = new FakeWorkerScope();
            const refused = new RecordingHost("gpu");
            new SceneViewChannel(withoutPresenter).attach(refused);
            withoutPresenter.send(open(PIXEL_SURFACE));
            const onCells = new FakeWorkerScope();
            const cellsRefused = new RecordingHost("gpu", canvasPresenterFactory([]));
            new SceneViewChannel(onCells).attach(cellsRefused);
            onCells.send(open(CELL_SURFACE));
            expect([refused.shown.length, withoutPresenter.kinds(), cellsRefused.shown.length, onCells.kinds()]).toEqual([0, ["error"], 0, ["error"]]);
        });
    });

    test("each presented frame message carries the world's view info for that frame, whatever the backend", () => {
        const pixels = new FakeWorkerScope();
        const pixelHost = new RecordingHost("pixels");
        pixelHost.reportsFrameInfo = true;
        new SceneViewChannel(pixels).attach(pixelHost);
        pixels.send(open(PIXEL_SURFACE));
        pixelPresenterOf(pixelHost).present(pixelFrame(4, 2));
        pixelPresenterOf(pixelHost).present(pixelFrame(4, 2));
        expect(pixels.posted.map(({message}) => message.kind === "pixelFrame" ? message.info : undefined)).toEqual([viewInfo(VIEW, 1), viewInfo(VIEW, 2)]);

        const cells = new FakeWorkerScope();
        const cellHost = new RecordingHost("cells");
        cellHost.reportsFrameInfo = true;
        new SceneViewChannel(cells).attach(cellHost);
        cells.send(open(CELL_SURFACE));
        cellPresenterOf(cellHost).present(cellFrame(3, 2), "full");
        expect(cells.posted.map(({message}) => message.kind === "frame" ? message.info : undefined)).toEqual([viewInfo(VIEW, 1)]);

        withBrowserGlobals(() => {
            const gpu = new FakeWorkerScope();
            const gpuHost = new RecordingHost("gpu", canvasPresenterFactory([]));
            gpuHost.reportsFrameInfo = true;
            new SceneViewChannel(gpu).attach(gpuHost);
            gpu.send(open(PIXEL_SURFACE));
            pixelPresenterOf(gpuHost).present(pixelFrame(4, 2));
            gpu.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented"});
            pixelPresenterOf(gpuHost).present(pixelFrame(4, 2));
            expect(gpu.kinds()).toEqual(["bitmapFrame", "bitmapFrame"]);
            expect(gpu.posted.map(({message}) => message.kind === "bitmapFrame" ? message.info : undefined)).toEqual([viewInfo(VIEW, 1), viewInfo(VIEW, 2)]);
        });

        const silent = new FakeWorkerScope();
        const silentHost = new RecordingHost("pixels");
        new SceneViewChannel(silent).attach(silentHost);
        silent.send(open(PIXEL_SURFACE));
        pixelPresenterOf(silentHost).present(pixelFrame(4, 2));
        expect("info" in silent.posted[0].message).toBe(false);
    });
});

class FakeWorker {
    public readonly posted: {message: SceneViewPageMessage, transfer: PageTransferable[]}[] = [];
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public postMessage(message: SceneViewPageMessage, transfer: PageTransferable[]): void {
        this.posted.push({message, transfer});
    }

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.push(listener);
    }

    public removeEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.splice(this.listeners.indexOf(listener), 1);
    }

    public get listenerCount(): number {
        return this.listeners.length;
    }

    public send(data: unknown): void {
        for (const listener of [...this.listeners]) listener({data});
    }
}

class RecordingPixelDisplay implements PixelWorldDisplay {
    public readonly shown: string[] = [];
    public readonly frames: PixelFrame[] = [];
    public surface: PixelSurfaceSize = PIXEL_SURFACE;
    private resized: (() => void) | undefined;

    public surfaceSize(): PixelSurfaceSize {
        return this.surface;
    }

    public onResize(listener: () => void): () => void {
        this.resized = listener;
        return () => {
            this.resized = undefined;
        };
    }

    public resize(surface: PixelSurfaceSize): void {
        this.surface = surface;
        this.resized?.();
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.frames.push(frame);
        onPresented();
    }

    public showStatus(text: string): void {
        this.shown.push(`status: ${text}`);
    }

    public hideStatus(): void {
        this.shown.push("hidden");
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }
}

class RecordingCellDisplay implements CellWorldDisplay {
    public readonly shown: string[] = [];

    public surfaceSize(): CellSurfaceSize {
        return CELL_SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentCells(_frame: CellFrame, onPresented: () => void): void {
        onPresented();
    }

    public showStatus(): void {
    }

    public hideStatus(): void {
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }
}

class RecordingBitmapDisplay implements BitmapWorldDisplay {
    public readonly frames: BitmapFrame[] = [];

    public surfaceSize(): PixelSurfaceSize {
        return PIXEL_SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentBitmap(frame: BitmapFrame, onPresented: () => void): void {
        this.frames.push(frame);
        onPresented();
    }

    public showStatus(): void {
    }

    public hideStatus(): void {
    }

    public showError(): void {
    }
}

describe("scene view connection on the page", () => {
    test("opens with the display's surface, sends its resizes, draws frames and returns their buffers, and hides the status once the world is ready", () => {
        const worker = new FakeWorker();
        const display = new RecordingPixelDisplay();
        const connection = connectSceneView(display, worker, SHOWN_VIEW);
        expect(worker.posted.map(({message}) => message)).toEqual([{type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "open", surface: PIXEL_SURFACE}]);
        display.resize(RESIZED_PIXEL_SURFACE);
        expect(worker.posted[1].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: RESIZED_PIXEL_SURFACE});

        const frame = pixelFrame(8, 6);
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame});
        expect(display.frames).toEqual([frame]);
        expect(worker.posted[2]).toEqual({message: {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented", returnedBuffer: frame.rgba.buffer as ArrayBuffer}, transfer: [frame.rgba.buffer as ArrayBuffer]});
        worker.send({type: "ready"});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "error", message: "no canvas"});
        expect(display.shown).toEqual([`status: Starting ${NAME}...`, "hidden", `error: ${sceneViewFailureMessage(NAME, "no canvas")}`]);

        connection.close();
        connection.close();
        display.resize(PIXEL_SURFACE);
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame});
        expect(worker.posted.slice(3).map(({message}) => message)).toEqual([{type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "close"}]);
        expect([display.frames.length, worker.listenerCount]).toEqual([1, 0]);
    });

    test("a hidden scene view reports an empty surface of its kind, ignores resizes until shown, then reports its size again", () => {
        const worker = new FakeWorker();
        const display = new RecordingPixelDisplay();
        const connection = connectSceneView(display, worker, SHOWN_VIEW);
        connection.setShown(false);
        connection.setShown(false);
        display.resize(RESIZED_PIXEL_SURFACE);
        connection.setShown(true);
        expect(worker.posted.slice(1).map(({message}) => message)).toEqual([
            {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: {kind: "pixels", widthPx: 0, heightPx: 0}},
            {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: RESIZED_PIXEL_SURFACE},
        ]);
        const cells = new FakeWorker();
        connectSceneView(new RecordingCellDisplay(), cells, SHOWN_VIEW).setShown(false);
        expect(cells.posted[1].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "resize", surface: {kind: "cells", columns: 0, rows: 0}});
    });

    test("a bitmap display opens with its surface alone, draws each bitmap frame and acknowledges it; a display that cannot draw bitmaps closes them; frames of the wrong kind are an error", () => {
        withBrowserGlobals(() => {
            const worker = new FakeWorker();
            const bitmaps = new RecordingBitmapDisplay();
            connectSceneView(bitmaps, worker, SHOWN_VIEW);
            expect(worker.posted[0]).toEqual({message: {type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "open", surface: PIXEL_SURFACE}, transfer: []});
            const frame = bitmapFrame();
            worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame});
            expect(bitmaps.frames).toEqual([frame]);
            expect(worker.posted[1].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented"});

            const pixels = new RecordingPixelDisplay();
            const pixelWorker = new FakeWorker();
            connectSceneView(pixels, pixelWorker, SHOWN_VIEW);
            const refused = bitmapFrame();
            pixelWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame: refused});
            expect([closed(refused), pixels.shown.includes(`error: ${sceneViewMismatchMessage(NAME, "bitmap")}`)]).toEqual([true, true]);
        });

        const cells = new RecordingCellDisplay();
        const cellWorker = new FakeWorker();
        connectSceneView(cells, cellWorker, SHOWN_VIEW);
        cellWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame: pixelFrame(1, 1)});
        cellWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "frame", frame: cellFrame(3, 2)});
        expect(cells.shown.length).toBe(1);
        expect(cellWorker.posted.map(({message}) => message.kind)).toEqual(["open", "presented"]);
    });

    test("hands on the view info that arrives with each of its view's frames as the frame arrives", () => {
        const received: (EditorViewInfo | string)[] = [];
        const worker = new FakeWorker();
        const display = new RecordingPixelDisplay();
        const presentPixels = display.presentPixels.bind(display);
        display.presentPixels = (frame, onPresented) => {
            received.push(DRAWN);
            presentPixels(frame, onPresented);
        };
        connectSceneView(display, worker, {...SHOWN_VIEW, frameInfo: info => received.push(info)});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame: pixelFrame(4, 2), info: viewInfo(VIEW, 1)});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame: pixelFrame(4, 2)});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "pixelFrame", frame: pixelFrame(4, 2), info: viewInfo(SECOND_VIEW, 1)});
        expect(received).toEqual([DRAWN, viewInfo(VIEW, 1), DRAWN]);

        withBrowserGlobals(() => {
            const bitmapInfos: EditorViewInfo[] = [];
            const bitmapWorker = new FakeWorker();
            connectSceneView(new RecordingBitmapDisplay(), bitmapWorker, {...SHOWN_VIEW, frameInfo: info => bitmapInfos.push(info)});
            bitmapWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "bitmapFrame", frame: bitmapFrame(), info: viewInfo(VIEW, 3)});
            bitmapWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "bitmapFrame", frame: bitmapFrame(), info: viewInfo(SECOND_VIEW, 4)});
            expect(bitmapInfos).toEqual([viewInfo(VIEW, 3)]);
        });

        const cellInfos: EditorViewInfo[] = [];
        const cellWorker = new FakeWorker();
        connectSceneView(new RecordingCellDisplay(), cellWorker, {...SHOWN_VIEW, frameInfo: info => cellInfos.push(info)});
        cellWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "frame", frame: cellFrame(3, 2), info: viewInfo(VIEW, 5)});
        expect(cellInfos).toEqual([viewInfo(VIEW, 5)]);
    });
});

describe("several scene views over one channel", () => {
    test("messages without a scene view id, or with another view's kind of id, are not scene view messages", () => {
        expect(isSceneViewPageMessage({type: SCENE_VIEW_MESSAGE_TYPE, kind: "close"})).toBe(false);
        expect(isSceneViewPageMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: "game", kind: "close"})).toBe(false);
        expect(isSceneViewPageMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "close"})).toBe(true);
        expect(isSceneViewWorkerMessage({type: SCENE_VIEW_MESSAGE_TYPE, view: "scene:0", kind: "error", message: "broken"})).toBe(false);
    });

    test("each view gets its own presenter, sized, acknowledged and counted on its own, and a closed view can open again", () => {
        const scope = new FakeWorkerScope();
        const channel = new SceneViewChannel(scope);
        const host = new RecordingHost("pixels");
        channel.attach(host);
        scope.send(open(PIXEL_SURFACE));
        scope.send(open(RESIZED_PIXEL_SURFACE, SECOND_VIEW));
        expect(host.opened).toEqual([VIEW, SECOND_VIEW]);
        const [firstView, secondView] = host.shown;
        if (firstView.kind !== "pixels" || secondView.kind !== "pixels") throw new Error("pixel presenters were expected");
        expect([firstView.presenter.size().widthPx, secondView.presenter.size().widthPx]).toEqual([4, 8]);
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "resize", surface: {kind: "pixels", widthPx: 0, heightPx: 0}});
        expect([firstView.presenter.size().widthPx, secondView.presenter.size().widthPx]).toEqual([4, 0]);

        firstView.presenter.present(pixelFrame(4, 2));
        firstView.presenter.present(pixelFrame(4, 2));
        secondView.presenter.present(pixelFrame(8, 6));
        expect([firstView.presenter.backlogged?.(), secondView.presenter.backlogged?.()]).toEqual([true, false]);
        expect([firstView.presentedFrames(), secondView.presentedFrames()]).toEqual([2, 1]);
        expect(scope.posted.map(({message}) => message.view)).toEqual([VIEW, VIEW, SECOND_VIEW]);
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "presented"});
        expect(firstView.presenter.backlogged?.()).toBe(true);
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "presented"});
        expect(firstView.presenter.backlogged?.()).toBe(false);

        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "close"});
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "close"});
        expect(host.closed).toEqual([SECOND_VIEW]);
        scope.send(open(PIXEL_SURFACE, SECOND_VIEW));
        expect(host.opened).toEqual([VIEW, SECOND_VIEW, SECOND_VIEW]);
        expect(host.shown[2]).not.toBe(secondView);
    });

    test("closing a view disposes the presenter the channel made for it", () => {
        const scope = new FakeWorkerScope();
        let disposed = 0;
        const host = new RecordingHost("gpu", (_canvas, surface) => ({size: surface.size, onResize: surface.onResize, start: () => {}, stop: () => {}, present: () => {}, dispose: () => disposed++}));
        withBrowserGlobals(() => {
            new SceneViewChannel(scope).attach(host);
            scope.send(open(PIXEL_SURFACE, SECOND_VIEW));
        });
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "close"});
        expect([host.closed, disposed]).toEqual([[SECOND_VIEW], 1]);
    });

    test("a page connection only takes its own view's frames, and a hidden view opens with an empty surface", () => {
        const worker = new FakeWorker();
        const display = new RecordingPixelDisplay();
        connectSceneView(display, worker, {view: SECOND_VIEW, name: NAME, shown: false});
        expect(worker.posted[0].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "open", surface: {kind: "pixels", widthPx: 0, heightPx: 0}});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: VIEW, kind: "pixelFrame", frame: pixelFrame(4, 2)});
        expect(display.frames.length).toBe(0);
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "pixelFrame", frame: pixelFrame(4, 2)});
        expect(display.frames.length).toBe(1);
        expect(worker.posted[1].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, view: SECOND_VIEW, kind: "presented", returnedBuffer: display.frames[0].rgba.buffer as ArrayBuffer});
    });
});
