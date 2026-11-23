import {CanvasDisplayShell, currentDevicePixelRatio} from "./canvasDisplayShell";
import type {CellArea} from "./domInput";
import type {GpuWorldDisplay} from "./worldWorkerPage";
import type {PixelSurfaceSize} from "./worldWorkerProtocol";
import {fitFramebuffer, NO_SCREEN_UNITS, PIXELATED_IMAGE_RENDERING, pixelCanvasDisplayOptionsFromQuery} from "./pixelCanvasDisplay";
import type {PixelCanvasDisplayOptions, ScreenUnitPx} from "./pixelCanvasDisplay";

const VISIBLE = true;

function drawsNoFrames(): void {
}

export class GpuCanvasDisplay implements GpuWorldDisplay {
    private readonly shell: CanvasDisplayShell<never>;
    private readonly resizeListeners = new Set<() => void>();
    private widthPx = 0;
    private heightPx = 0;
    private transferred = false;
    private screenUnit: ScreenUnitPx | undefined;

    public constructor(container: HTMLElement, private readonly options: PixelCanvasDisplayOptions = {}, visible: boolean = VISIBLE) {
        this.shell = new CanvasDisplayShell<never>(container, drawsNoFrames);
        this.shell.canvas.style.imageRendering = PIXELATED_IMAGE_RENDERING;
        this.shell.mount(this.fit, visible);
    }

    public show(): void {
        this.shell.show();
    }

    public hide(): void {
        this.shell.hide();
    }

    public hasFocus(): boolean {
        return this.shell.hasFocus();
    }

    public focus(): void {
        this.shell.focus();
    }

    public dispose(): void {
        this.resizeListeners.clear();
        this.shell.dispose();
    }

    public surfaceSize(): PixelSurfaceSize {
        return {kind: "pixels", widthPx: this.widthPx, heightPx: this.heightPx};
    }

    public onResize(listener: () => void): () => void {
        const entry = () => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    public transferCanvas(): OffscreenCanvas {
        this.transferred = true;
        return this.shell.canvas.transferControlToOffscreen();
    }

    public showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        this.screenUnit = {x: pixelsPerScreenUnitX, y: pixelsPerScreenUnitY};
        this.shell.hideStatus();
    }

    public showStatus(text: string): void {
        this.shell.showStatus(text);
    }

    public hideStatus(): void {
        this.shell.hideStatus();
    }

    public showError(text: string): void {
        this.shell.showError(text);
    }

    public cellArea(): CellArea {
        const bounds = this.shell.canvas.getBoundingClientRect();
        const unit = this.screenUnit;
        return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            columns: unit === undefined ? NO_SCREEN_UNITS : this.widthPx / unit.x,
            rows: unit === undefined ? NO_SCREEN_UNITS : this.heightPx / unit.y,
        };
    }

    private readonly fit = (): void => {
        const fitted = fitFramebuffer(this.shell.containerBounds(), currentDevicePixelRatio(), this.options);
        const canvas = this.shell.canvas;
        if (!this.transferred) {
            canvas.width = fitted.widthPx;
            canvas.height = fitted.heightPx;
        }
        canvas.style.width = `${fitted.cssWidthPx}px`;
        canvas.style.height = `${fitted.cssHeightPx}px`;
        if (fitted.widthPx === this.widthPx && fitted.heightPx === this.heightPx) return;
        this.widthPx = fitted.widthPx;
        this.heightPx = fitted.heightPx;
        for (const listener of [...this.resizeListeners]) listener();
    };
}

export function gpuCanvasDisplayFromQuery(container: HTMLElement, search: string, defaultPixelScale?: number): GpuCanvasDisplay {
    return new GpuCanvasDisplay(container, pixelCanvasDisplayOptionsFromQuery(search, defaultPixelScale));
}

export function gpuCanvasDisplayScaledBy(pixelScale: number): (container: HTMLElement, search: string) => GpuCanvasDisplay {
    return (container, search) => gpuCanvasDisplayFromQuery(container, search, pixelScale);
}
