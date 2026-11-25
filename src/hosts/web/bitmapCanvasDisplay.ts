import {discardBitmapFrame} from "./bitmapFrame";
import type {BitmapFrame} from "./bitmapFrame";
import {CanvasDisplayShell} from "./canvasDisplayShell";
import type {CellArea} from "./domInput";
import {fitFramebuffer, NO_SCREEN_UNITS, PIXELATED_IMAGE_RENDERING, pixelCanvasDisplayOptionsFromQuery} from "./pixelCanvasDisplay";
import type {PixelCanvasDisplayOptions, ScreenUnitPx} from "./pixelCanvasDisplay";
import type {PixelSurfaceSize} from "./worldWorkerProtocol";

const VISIBLE = true;
const BITMAP_RENDERER = "bitmaprenderer";

export interface BitmapWorldDisplay {
    surfaceSize(): PixelSurfaceSize;
    onResize(listener: () => void): () => void;
    presentBitmap(frame: BitmapFrame, onPresented: () => void): void;
    showStatus(text: string): void;
    hideStatus(): void;
    showError(text: string): void;
}

export class BitmapCanvasDisplay implements BitmapWorldDisplay {
    private readonly shell: CanvasDisplayShell<BitmapFrame>;
    private readonly resizeListeners = new Set<() => void>();
    private context: ImageBitmapRenderingContext | undefined;
    private widthPx = 0;
    private heightPx = 0;
    private screenUnit: ScreenUnitPx | undefined;

    public constructor(container: HTMLElement, private readonly options: PixelCanvasDisplayOptions = {}, visible: boolean = VISIBLE) {
        this.shell = new CanvasDisplayShell<BitmapFrame>(container, frame => this.draw(frame), discardBitmapFrame);
        this.shell.canvas.style.imageRendering = PIXELATED_IMAGE_RENDERING;
        this.shell.mount(this.fit, visible);
    }

    public show(): void {
        this.shell.show();
    }

    public hide(): void {
        this.shell.hide();
    }

    public dispose(): void {
        this.resizeListeners.clear();
        this.shell.dispose();
    }

    public surfaceSize(): PixelSurfaceSize {
        return {kind: "pixels", widthPx: this.widthPx, heightPx: this.heightPx};
    }

    public onResize(listener: () => void): () => void {
        const entry = (): void => listener();
        this.resizeListeners.add(entry);
        return () => {
            this.resizeListeners.delete(entry);
        };
    }

    public presentBitmap(frame: BitmapFrame, onPresented: () => void): void {
        this.shell.present(frame, onPresented);
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

    private draw(frame: BitmapFrame): void {
        this.screenUnit = {x: frame.pixelsPerScreenUnitX, y: frame.pixelsPerScreenUnitY};
        const context = this.context ??= this.shell.canvas.getContext(BITMAP_RENDERER) ?? undefined;
        if (context === undefined) {
            discardBitmapFrame(frame);
            return;
        }
        context.transferFromImageBitmap(frame.bitmap);
    }

    private readonly fit = (): void => {
        const fitted = fitFramebuffer(this.shell.containerBounds(), this.shell.devicePixelRatio(), this.options);
        const canvas = this.shell.canvas;
        canvas.style.width = `${fitted.cssWidthPx}px`;
        canvas.style.height = `${fitted.cssHeightPx}px`;
        if (fitted.widthPx === this.widthPx && fitted.heightPx === this.heightPx) return;
        canvas.width = fitted.widthPx;
        canvas.height = fitted.heightPx;
        this.widthPx = fitted.widthPx;
        this.heightPx = fitted.heightPx;
        for (const listener of [...this.resizeListeners]) listener();
    };
}

export function bitmapCanvasDisplayFromQuery(container: HTMLElement, search: string, visible: boolean = VISIBLE, defaultPixelScale?: number): BitmapCanvasDisplay {
    return new BitmapCanvasDisplay(container, pixelCanvasDisplayOptionsFromQuery(search, defaultPixelScale), visible);
}
