import {describe, expect, test} from "../../engine/testing/harness";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {CellPresenter} from "../../backends/cells/cellPresenter";
import type {GpuCanvasPresenterFactory, GpuCanvasSurfaceSize} from "../../backends/gpu/gpuCanvasPixelPresenter";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {PixelPresenter} from "../../backends/pixels/pixelPresenter";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {TextColor} from "../../engine/rendering/textColor";
import type {CellWorldDisplay, GpuWorldDisplay, PageTransferable, PixelWorldDisplay} from "../../hosts/web/worldWorkerPage";
import {isPageToWorldMessage, isWorldToPageMessage} from "../../hosts/web/worldWorkerProtocol";
import type {CellSurfaceSize, PixelSurfaceSize, SurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {SceneViewPresenter} from "../world/editorViews";
import {SceneViewChannel} from "./sceneViewChannel";
import type {SceneViewScope} from "./sceneViewChannel";
import {connectSceneView, sceneViewFailureMessage} from "./sceneViewConnection";
import {isSceneViewPageMessage, isSceneViewWorkerMessage, SCENE_VIEW_MESSAGE_TYPE} from "./sceneViewProtocol";
import type {SceneViewPageMessage, SceneViewWorkerMessage} from "./sceneViewProtocol";

const PIXEL_SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 4, heightPx: 2};
const RESIZED_PIXEL_SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 8, heightPx: 6};
const CELL_SURFACE: CellSurfaceSize = {kind: "cells", columns: 3, rows: 2};
const RGBA_BYTES_PER_PIXEL = 4;
const SCREEN_UNIT_X = 8;
const SCREEN_UNIT_Y = 16;
const NAME = "the demo";
const SPACE = 0x20;

function pixelFrame(widthPx: number, heightPx: number): PixelFrame {
    return {widthPx, heightPx, rgba: new Uint8ClampedArray(widthPx * heightPx * RGBA_BYTES_PER_PIXEL), pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y};
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

class FakeOffscreenCanvas {
}

function withOffscreenCanvasGlobal(body: () => void): void {
    const scope = globalThis as {OffscreenCanvas?: unknown};
    const previous = scope.OffscreenCanvas;
    scope.OffscreenCanvas = FakeOffscreenCanvas;
    try {
        body();
    } finally {
        if (previous === undefined) delete scope.OffscreenCanvas;
        else scope.OffscreenCanvas = previous;
    }
}

class FakeWorkerScope implements SceneViewScope {
    public readonly posted: {message: SceneViewWorkerMessage, transfer: ArrayBuffer[] | undefined}[] = [];
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public postMessage(message: SceneViewWorkerMessage, transfer?: ArrayBuffer[]): void {
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
    public readonly canvases: OffscreenCanvas[] = [];

    public constructor(public readonly backend: RenderBackendKind, public readonly canvasPresenter?: GpuCanvasPresenterFactory) {
    }

    public show(view: SceneViewPresenter): void {
        this.shown.push(view);
    }
}

function open(surface: SurfaceSize, canvas?: OffscreenCanvas): SceneViewPageMessage {
    return canvas === undefined ? {type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface} : {type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface, canvas};
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
        const page: SceneViewPageMessage[] = [open(PIXEL_SURFACE), {type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: CELL_SURFACE}, {type: SCENE_VIEW_MESSAGE_TYPE, kind: "presented"}];
        const worker: SceneViewWorkerMessage[] = [
            {type: SCENE_VIEW_MESSAGE_TYPE, kind: "pixelFrame", frame: pixelFrame(1, 1)},
            {type: SCENE_VIEW_MESSAGE_TYPE, kind: "screenUnit", pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y},
            {type: SCENE_VIEW_MESSAGE_TYPE, kind: "error", message: "broken"},
        ];
        expect(page.every(isSceneViewPageMessage)).toBe(true);
        expect(worker.every(isSceneViewWorkerMessage)).toBe(true);
        expect([...page, ...worker].some(message => isPageToWorldMessage(message) || isWorldToPageMessage(message))).toBe(false);
        expect(worker.some(isSceneViewPageMessage) || page.some(isSceneViewWorkerMessage)).toBe(false);
        expect(isSceneViewPageMessage({type: "resize", surface: CELL_SURFACE})).toBe(false);
        expect(isSceneViewPageMessage({type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface: {kind: "pixels", widthPx: -1, heightPx: 2}})).toBe(false);
        expect(isSceneViewPageMessage({type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface: PIXEL_SURFACE, canvas: {}})).toBe(false);
        expect(isSceneViewWorkerMessage({type: SCENE_VIEW_MESSAGE_TYPE, kind: "screenUnit", pixelsPerScreenUnitX: 0, pixelsPerScreenUnitY: 1})).toBe(false);
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
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: RESIZED_PIXEL_SURFACE});
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: CELL_SURFACE});
        expect([resizes, presenter.size().widthPx]).toEqual([1, 8]);

        presenter.present(pixelFrame(8, 6));
        expect(presenter.backlogged?.()).toBe(false);
        presenter.present(pixelFrame(8, 6));
        expect(presenter.backlogged?.()).toBe(true);
        const [first] = scope.posted;
        expect(first.message.kind).toBe("pixelFrame");
        expect(first.transfer?.length).toBe(1);
        const returned = (first.message as {frame: PixelFrame}).frame.rgba.buffer as ArrayBuffer;
        scope.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "presented", returnedBuffer: returned});
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

    test("a gpu world hands the transferred canvas to its canvas presenter and reports each new screen unit once", () => {
        withOffscreenCanvasGlobal(() => {
            const scope = new FakeWorkerScope();
            const canvas = new FakeOffscreenCanvas() as unknown as OffscreenCanvas;
            const surfaces: GpuCanvasSurfaceSize[] = [];
            const made: PixelPresenter[] = [];
            const host = new RecordingHost("gpu", (given, surface, reportScreenUnit) => {
                expect(given).toBe(canvas);
                surfaces.push(surface);
                reportScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y);
                reportScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y);
                const presenter = {size: surface.size, onResize: surface.onResize, start: () => {}, stop: () => {}, present: () => {}};
                made.push(presenter);
                return presenter;
            });
            new SceneViewChannel(scope).attach(host);
            scope.send(open(PIXEL_SURFACE, canvas));
            expect(pixelPresenterOf(host)).toBe(made[0]);
            expect(surfaces[0].size()).toEqual({widthPx: 4, heightPx: 2});
            expect(scope.kinds()).toEqual(["screenUnit"]);

            const withoutCanvas = new FakeWorkerScope();
            const refused = new RecordingHost("gpu", () => {
                throw new Error("not called");
            });
            new SceneViewChannel(withoutCanvas).attach(refused);
            withoutCanvas.send(open(PIXEL_SURFACE));
            expect([refused.shown.length, withoutCanvas.kinds()]).toEqual([0, ["error"]]);
        });
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

    public send(data: unknown): void {
        for (const listener of this.listeners) listener({data});
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

class RecordingGpuDisplay implements GpuWorldDisplay {
    public readonly canvas = {} as OffscreenCanvas;
    public readonly screenUnits: [number, number][] = [];

    public surfaceSize(): PixelSurfaceSize {
        return PIXEL_SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public transferCanvas(): OffscreenCanvas {
        return this.canvas;
    }

    public showScreenUnit(x: number, y: number): void {
        this.screenUnits.push([x, y]);
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
        const connection = connectSceneView(display, worker, NAME);
        expect(worker.posted.map(({message}) => message)).toEqual([{type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface: PIXEL_SURFACE}]);
        display.resize(RESIZED_PIXEL_SURFACE);
        expect(worker.posted[1].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: RESIZED_PIXEL_SURFACE});

        const frame = pixelFrame(8, 6);
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "pixelFrame", frame});
        expect(display.frames).toEqual([frame]);
        expect(worker.posted[2]).toEqual({message: {type: SCENE_VIEW_MESSAGE_TYPE, kind: "presented", returnedBuffer: frame.rgba.buffer as ArrayBuffer}, transfer: [frame.rgba.buffer as ArrayBuffer]});
        worker.send({type: "ready"});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "error", message: "no canvas"});
        expect(display.shown).toEqual([`status: Starting ${NAME}...`, "hidden", `error: ${sceneViewFailureMessage(NAME, "no canvas")}`]);

        connection.close();
        display.resize(PIXEL_SURFACE);
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "pixelFrame", frame});
        expect([worker.posted.length, display.frames.length]).toEqual([3, 1]);
    });

    test("a hidden scene view reports an empty surface of its kind, ignores resizes until shown, then reports its size again", () => {
        const worker = new FakeWorker();
        const display = new RecordingPixelDisplay();
        const connection = connectSceneView(display, worker, NAME);
        connection.setShown(false);
        connection.setShown(false);
        display.resize(RESIZED_PIXEL_SURFACE);
        connection.setShown(true);
        expect(worker.posted.slice(1).map(({message}) => message)).toEqual([
            {type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: {kind: "pixels", widthPx: 0, heightPx: 0}},
            {type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: RESIZED_PIXEL_SURFACE},
        ]);
        const cells = new FakeWorker();
        connectSceneView(new RecordingCellDisplay(), cells, NAME).setShown(false);
        expect(cells.posted[1].message).toEqual({type: SCENE_VIEW_MESSAGE_TYPE, kind: "resize", surface: {kind: "cells", columns: 0, rows: 0}});
    });

    test("a gpu display transfers its canvas with the open request and shows screen units; frames of the wrong kind are an error", () => {
        const worker = new FakeWorker();
        const gpu = new RecordingGpuDisplay();
        connectSceneView(gpu, worker, NAME);
        expect(worker.posted[0]).toEqual({message: {type: SCENE_VIEW_MESSAGE_TYPE, kind: "open", surface: PIXEL_SURFACE, canvas: gpu.canvas}, transfer: [gpu.canvas]});
        worker.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "screenUnit", pixelsPerScreenUnitX: SCREEN_UNIT_X, pixelsPerScreenUnitY: SCREEN_UNIT_Y});
        expect(gpu.screenUnits).toEqual([[SCREEN_UNIT_X, SCREEN_UNIT_Y]]);

        const cells = new RecordingCellDisplay();
        const cellWorker = new FakeWorker();
        connectSceneView(cells, cellWorker, NAME);
        cellWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "pixelFrame", frame: pixelFrame(1, 1)});
        cellWorker.send({type: SCENE_VIEW_MESSAGE_TYPE, kind: "frame", frame: cellFrame(3, 2)});
        expect(cells.shown.length).toBe(1);
        expect(cellWorker.posted.map(({message}) => message.kind)).toEqual(["open", "presented"]);
    });
});
