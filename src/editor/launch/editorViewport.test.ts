import {describe, expect, test} from "../../engine/testing/harness";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {CellArea} from "../../hosts/web/domInput";
import {displayBackendOf} from "../../hosts/web/worldWorkerPage";
import type {PixelSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import {
    chooseEditorRenderBackend,
    EDITOR_DEFAULT_RENDER_BACKEND,
    GpuEditorViewport,
    NO_CELL_AREA,
    PixelEditorViewport,
    renderBackendLabelText,
} from "./editorViewport";
import type {SessionDisplayEvents, SessionGpuCanvas, SharedPixelDisplay} from "./editorViewport";

const SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 64, heightPx: 32};
const FRAME: PixelFrame = {widthPx: 1, heightPx: 1, rgba: new Uint8ClampedArray(4), pixelsPerScreenUnitX: 8, pixelsPerScreenUnitY: 16};
const VISIBLE = true;
const HIDDEN = false;
const SCREEN_UNIT_X = 8;
const SCREEN_UNIT_Y = 16;

function areaOf(columns: number): CellArea {
    return {left: 0, top: 0, width: 10, height: 10, columns, rows: 1};
}

class RecordedEvents implements SessionDisplayEvents {
    public firstFrames = 0;
    public readonly failures: string[] = [];

    public firstFrame(): void {
        this.firstFrames++;
    }

    public failed(text: string): void {
        this.failures.push(text);
    }
}

class FakePixelDisplay implements SharedPixelDisplay {
    public readonly shown: string[] = [];
    public presented = 0;

    public surfaceSize(): PixelSurfaceSize {
        return SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentPixels(_frame: PixelFrame, onPresented: () => void): void {
        this.presented++;
        onPresented();
    }

    public showStatus(text: string): void {
        this.shown.push(`status: ${text}`);
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }

    public cellArea(): CellArea {
        return areaOf(1);
    }
}

class FakeGpuCanvas implements SessionGpuCanvas {
    public readonly shown: string[] = [];
    public readonly screenUnits: [number, number][] = [];
    public visible: boolean;
    public focused = false;
    public disposed = false;
    public transfers = 0;

    public constructor(visible: boolean, private readonly columns: number) {
        this.visible = visible;
    }

    public surfaceSize(): PixelSurfaceSize {
        return SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public transferCanvas(): OffscreenCanvas {
        this.transfers++;
        return {} as OffscreenCanvas;
    }

    public showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        this.screenUnits.push([pixelsPerScreenUnitX, pixelsPerScreenUnitY]);
    }

    public showStatus(text: string): void {
        this.shown.push(`status: ${text}`);
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }

    public cellArea(): CellArea {
        return areaOf(this.columns);
    }

    public show(): void {
        this.visible = true;
    }

    public hide(): void {
        this.visible = false;
        this.focused = false;
    }

    public hasFocus(): boolean {
        return this.focused;
    }

    public focus(): void {
        this.focused = this.visible;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

function gpuViewport(): {readonly viewport: GpuEditorViewport, readonly canvases: FakeGpuCanvas[]} {
    const canvases: FakeGpuCanvas[] = [];
    const viewport = new GpuEditorViewport(visible => {
        const canvas = new FakeGpuCanvas(visible, canvases.length + 1);
        canvases.push(canvas);
        return canvas;
    });
    return {viewport, canvases};
}

describe("chooseEditorRenderBackend", () => {
    test("the editor renders with pixels unless ?backend=gpu asks for WebGPU; cells is not an editor backend", () => {
        expect(chooseEditorRenderBackend("pixels", true)).toEqual({backend: "pixels"});
        expect(chooseEditorRenderBackend("cells", true)).toEqual({backend: "pixels"});
        expect(EDITOR_DEFAULT_RENDER_BACKEND).toBe("pixels");
    });

    test("gpu is chosen when WebGPU is usable; otherwise pixels, with the reason for the fallback warning", () => {
        expect(chooseEditorRenderBackend("gpu", true)).toEqual({backend: "gpu"});
        const fallback = chooseEditorRenderBackend("gpu", false);
        expect(fallback.backend).toBe("pixels");
        expect(fallback.fallbackReason?.includes("WebGPU")).toBe(true);
    });

    test("the view tabs name the renderer", () => {
        expect(renderBackendLabelText("gpu")).toBe("Renderer: WebGPU (experimental)");
        expect(renderBackendLabelText("pixels")).toBe("Renderer: Pixels (CPU)");
    });
});

describe("PixelEditorViewport", () => {
    test("every session shares the one pixel display; hidden sessions acknowledge frames without drawing them", () => {
        const display = new FakePixelDisplay();
        const viewport = new PixelEditorViewport(display);
        const events = new RecordedEvents();
        const hidden = viewport.sessionDisplay(HIDDEN, events);
        expect(displayBackendOf(hidden)).toBe("pixels");
        let acknowledged = 0;
        if (!("presentPixels" in hidden)) throw new Error("a pixel session display presents pixels");
        hidden.presentPixels(FRAME, () => acknowledged++);
        hidden.presentPixels(FRAME, () => acknowledged++);
        expect([display.presented, acknowledged, events.firstFrames]).toEqual([0, 2, 1]);
        hidden.showStatus("loading");
        hidden.showError("broken");
        expect(display.shown).toEqual([]);
        expect(events.failures).toEqual(["broken"]);
        hidden.show();
        hidden.presentPixels(FRAME, () => acknowledged++);
        expect(display.presented).toBe(1);
        expect(viewport.cellArea()).toEqual(areaOf(1));
    });
});

describe("GpuEditorViewport", () => {
    test("each session gets its own canvas, transferred to its worker; the first screen unit is its first frame", () => {
        const {viewport, canvases} = gpuViewport();
        const events = new RecordedEvents();
        const session = viewport.sessionDisplay(VISIBLE, events);
        expect(displayBackendOf(session)).toBe("gpu");
        if (!("transferCanvas" in session)) throw new Error("a gpu session display transfers a canvas");
        session.transferCanvas();
        session.showScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y);
        session.showScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y);
        expect([canvases.length, canvases[0].transfers, events.firstFrames]).toEqual([1, 1, 1]);
        expect(canvases[0].screenUnits).toEqual([[SCREEN_UNIT_X, SCREEN_UNIT_Y], [SCREEN_UNIT_X, SCREEN_UNIT_Y]]);
        expect(viewport.cellArea()).toEqual(areaOf(1));
    });

    test("a hidden session's canvas stays hidden and quiet until it is shown, then takes over input mapping and focus", () => {
        const {viewport, canvases} = gpuViewport();
        const current = viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        canvases[0].focus();
        const reloadEvents = new RecordedEvents();
        const reloaded = viewport.sessionDisplay(HIDDEN, reloadEvents);
        expect(canvases[1].visible).toBe(false);
        reloaded.showStatus("Starting…");
        reloaded.showError("broken");
        expect(canvases[1].shown).toEqual([]);
        expect(reloadEvents.failures).toEqual(["broken"]);
        expect(viewport.cellArea()).toEqual(areaOf(1));

        current.hide();
        reloaded.show();
        current.dispose();
        expect([canvases[0].visible, canvases[0].disposed]).toEqual([false, true]);
        expect([canvases[1].visible, canvases[1].focused]).toEqual([true, true]);
        expect(viewport.cellArea()).toEqual(areaOf(2));
    });

    test("focus moves to the new canvas only when the old one had it", () => {
        const {viewport, canvases} = gpuViewport();
        const current = viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        const reloaded = viewport.sessionDisplay(HIDDEN, new RecordedEvents());
        current.hide();
        reloaded.show();
        expect(canvases[1].focused).toBe(false);
    });

    test("errors go to the shown session's canvas; with no session yet a canvas is made to show them", () => {
        const {viewport, canvases} = gpuViewport();
        expect(viewport.cellArea()).toEqual(NO_CELL_AREA);
        viewport.showError("no worker");
        expect(canvases.length).toBe(1);
        expect(canvases[0].shown).toEqual(["error: no worker"]);
        viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        viewport.showError("worker failed");
        expect(canvases[1].shown).toEqual(["error: worker failed"]);
    });
});
