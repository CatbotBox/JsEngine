import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import type {CellArea} from "../../hosts/web/domInput";
import {GpuCanvasDisplay} from "../../hosts/web/gpuCanvasDisplay";
import {pixelCanvasDisplayFromQuery, pixelCanvasDisplayOptionsFromQuery} from "../../hosts/web/pixelCanvasDisplay";
import type {PixelCanvasDisplay} from "../../hosts/web/pixelCanvasDisplay";
import {chooseRenderBackend} from "../../hosts/web/renderBackendBootstrap";
import type {GpuWorldDisplay, PixelWorldDisplay} from "../../hosts/web/worldWorkerPage";
import type {PixelSurfaceSize, RenderBackend} from "../../hosts/web/worldWorkerProtocol";

export type EditorRenderBackend = "pixels" | "gpu";

export const EDITOR_DEFAULT_RENDER_BACKEND: EditorRenderBackend = "pixels";
export const EDITOR_RENDER_BACKEND_LABELS: Readonly<Record<EditorRenderBackend, string>> = {
    pixels: "Pixels (CPU)",
    gpu: "WebGPU (experimental)",
};
export const NO_CELL_AREA: CellArea = {left: 0, top: 0, width: 0, height: 0, columns: 0, rows: 0};

const GPU_BACKEND: EditorRenderBackend = "gpu";
const EDITOR_HAS_GPU_BACKEND = true;
const VISIBLE = true;

export interface EditorRenderBackendChoice {
    readonly backend: EditorRenderBackend;
    readonly fallbackReason?: string;
}

export function chooseEditorRenderBackend(requested: RenderBackend, webGpuUsable: boolean): EditorRenderBackendChoice {
    if (requested !== GPU_BACKEND) return {backend: EDITOR_DEFAULT_RENDER_BACKEND};
    const choice = chooseRenderBackend(requested, {gpuScript: EDITOR_HAS_GPU_BACKEND, webGpuUsable});
    if (choice.backend === GPU_BACKEND) return {backend: GPU_BACKEND};
    return {backend: EDITOR_DEFAULT_RENDER_BACKEND, fallbackReason: choice.fallbackReason};
}

export function renderBackendLabelText(backend: EditorRenderBackend): string {
    return `Renderer: ${EDITOR_RENDER_BACKEND_LABELS[backend]}`;
}

export interface SessionDisplayEvents {
    firstFrame(): void;
    failed(text: string): void;
}

export interface SessionDisplayControls {
    show(): void;
    hide(): void;
    dispose(): void;
}

export type EditorSessionDisplay = (PixelWorldDisplay | GpuWorldDisplay) & SessionDisplayControls;

export interface EditorViewport {
    readonly renderBackend: EditorRenderBackend;

    sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay;

    cellArea(): CellArea;

    showError(text: string): void;
}

export type SharedPixelDisplay = Pick<PixelCanvasDisplay, "surfaceSize" | "onResize" | "presentPixels" | "showStatus" | "showError" | "cellArea">;

export class PixelSessionDisplay implements PixelWorldDisplay, SessionDisplayControls {
    private firstFrameSeen = false;

    public constructor(private readonly display: SharedPixelDisplay, private visible: boolean, private readonly events: SessionDisplayEvents) {
    }

    public show(): void {
        this.visible = true;
    }

    public hide(): void {
        this.visible = false;
    }

    public dispose(): void {
    }

    public surfaceSize(): PixelSurfaceSize {
        return this.display.surfaceSize();
    }

    public onResize(listener: () => void): () => void {
        return this.display.onResize(listener);
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        if (this.visible) this.display.presentPixels(frame, onPresented);
        else onPresented();
        if (this.firstFrameSeen) return;
        this.firstFrameSeen = true;
        this.events.firstFrame();
    }

    public showStatus(text: string): void {
        if (this.visible) this.display.showStatus(text);
    }

    public showError(text: string): void {
        if (this.visible) this.display.showError(text);
        this.events.failed(text);
    }
}

export class PixelEditorViewport implements EditorViewport {
    public readonly renderBackend: EditorRenderBackend = EDITOR_DEFAULT_RENDER_BACKEND;

    public constructor(private readonly display: SharedPixelDisplay) {
    }

    public sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay {
        return new PixelSessionDisplay(this.display, visible, events);
    }

    public cellArea(): CellArea {
        return this.display.cellArea();
    }

    public showError(text: string): void {
        this.display.showError(text);
    }
}

export type SessionGpuCanvas = Pick<GpuCanvasDisplay,
    "surfaceSize" | "onResize" | "transferCanvas" | "showScreenUnit" | "showStatus" | "showError" | "cellArea" | "show" | "hide" | "hasFocus" | "focus" | "dispose">;

interface GpuSessionHost {
    shown(canvas: SessionGpuCanvas): void;
    hiding(canvas: SessionGpuCanvas): void;
}

export class GpuSessionDisplay implements GpuWorldDisplay, SessionDisplayControls {
    private firstFrameSeen = false;

    public constructor(
        private readonly canvas: SessionGpuCanvas,
        private visible: boolean,
        private readonly events: SessionDisplayEvents,
        private readonly host: GpuSessionHost,
    ) {
    }

    public show(): void {
        this.visible = true;
        this.canvas.show();
        this.host.shown(this.canvas);
    }

    public hide(): void {
        this.host.hiding(this.canvas);
        this.visible = false;
        this.canvas.hide();
    }

    public dispose(): void {
        this.canvas.dispose();
    }

    public surfaceSize(): PixelSurfaceSize {
        return this.canvas.surfaceSize();
    }

    public onResize(listener: () => void): () => void {
        return this.canvas.onResize(listener);
    }

    public transferCanvas(): OffscreenCanvas {
        return this.canvas.transferCanvas();
    }

    public showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        this.canvas.showScreenUnit(pixelsPerScreenUnitX, pixelsPerScreenUnitY);
        if (this.firstFrameSeen) return;
        this.firstFrameSeen = true;
        this.events.firstFrame();
    }

    public showStatus(text: string): void {
        if (this.visible) this.canvas.showStatus(text);
    }

    public showError(text: string): void {
        if (this.visible) this.canvas.showError(text);
        this.events.failed(text);
    }
}

export class GpuEditorViewport implements EditorViewport {
    public readonly renderBackend: EditorRenderBackend = GPU_BACKEND;
    private current: SessionGpuCanvas | undefined;
    private focusHandedOver = false;

    private readonly host: GpuSessionHost = {
        shown: canvas => {
            this.current = canvas;
            if (this.focusHandedOver) canvas.focus();
            this.focusHandedOver = false;
        },
        hiding: canvas => {
            this.focusHandedOver = canvas.hasFocus();
        },
    };

    public constructor(private readonly createCanvas: (visible: boolean) => SessionGpuCanvas) {
    }

    public sessionDisplay(visible: boolean, events: SessionDisplayEvents): EditorSessionDisplay {
        const canvas = this.createCanvas(visible);
        if (visible) this.current = canvas;
        return new GpuSessionDisplay(canvas, visible, events, this.host);
    }

    public cellArea(): CellArea {
        return this.current?.cellArea() ?? NO_CELL_AREA;
    }

    public showError(text: string): void {
        const canvas = this.current ??= this.createCanvas(VISIBLE);
        canvas.showError(text);
    }
}

export function editorViewportFromQuery(backend: EditorRenderBackend, container: HTMLElement, search: string): EditorViewport {
    if (backend !== GPU_BACKEND) return new PixelEditorViewport(pixelCanvasDisplayFromQuery(container, search));
    const options = pixelCanvasDisplayOptionsFromQuery(search);
    return new GpuEditorViewport(visible => new GpuCanvasDisplay(container, options, visible));
}
