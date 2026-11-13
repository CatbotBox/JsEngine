import {CanvasPixelPresenter} from "../../backends/pixels/canvas/canvasPixelPresenter";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {CanvasDisplayShell, currentDevicePixelRatio} from "./canvasDisplayShell";
import type {CellArea} from "./domInput";
import type {PixelWorldDisplay} from "./worldWorkerPage";
import {FIXED_FRAMEBUFFER_LIMITS, fixedFramebufferSizeFromQuery, PIXEL_SCALE_LIMITS, pixelScaleFromQuery} from "./worldWorkerProtocol";
import type {FixedFramebufferSize, PixelSurfaceSize} from "./worldWorkerProtocol";

const PIXELATED_IMAGE_RENDERING = "pixelated";
const NO_SCREEN_UNITS = 0;

export interface PixelCanvasDisplayOptions {
    readonly fixed?: FixedFramebufferSize;
    readonly devicePixelsPerFramebufferPixel?: number;
}

interface ScreenUnitPx {
    readonly x: number;
    readonly y: number;
}

function fittedPixels(availableDevicePx: number, devicePixelsPerFramebufferPixel: number): number {
    return Math.min(FIXED_FRAMEBUFFER_LIMITS.maxPx, Math.max(FIXED_FRAMEBUFFER_LIMITS.minPx, Math.floor(availableDevicePx / devicePixelsPerFramebufferPixel)));
}

function defaultDevicePixelsPerFramebufferPixel(devicePixelRatio: number): number {
    return Math.min(PIXEL_SCALE_LIMITS.max, Math.max(PIXEL_SCALE_LIMITS.min, Math.round(devicePixelRatio)));
}

export class PixelCanvasDisplay implements PixelWorldDisplay {
    private readonly shell: CanvasDisplayShell<PixelFrame>;
    private readonly presenter: CanvasPixelPresenter<ImageData>;
    private screenUnit: ScreenUnitPx | undefined;

    public constructor(container: HTMLElement, private readonly options: PixelCanvasDisplayOptions = {}) {
        this.shell = new CanvasDisplayShell<PixelFrame>(container, frame => this.draw(frame));
        this.shell.canvas.style.imageRendering = PIXELATED_IMAGE_RENDERING;
        this.presenter = new CanvasPixelPresenter<ImageData>({canvas: this.shell.canvas, context: this.shell.context});
        this.shell.mount(this.fit);
    }

    public surfaceSize(): PixelSurfaceSize {
        const {widthPx, heightPx} = this.presenter.size();
        return {kind: "pixels", widthPx, heightPx};
    }

    public onResize(listener: () => void): () => void {
        return this.presenter.onResize(listener);
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.shell.present(frame, onPresented);
    }

    public showStatus(text: string): void {
        this.shell.showStatus(text);
    }

    public showError(text: string): void {
        this.shell.showError(text);
    }

    public cellArea(): CellArea {
        const canvas = this.shell.canvas;
        const bounds = canvas.getBoundingClientRect();
        const unit = this.screenUnit;
        return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            columns: unit === undefined ? NO_SCREEN_UNITS : canvas.width / unit.x,
            rows: unit === undefined ? NO_SCREEN_UNITS : canvas.height / unit.y,
        };
    }

    private draw(frame: PixelFrame): void {
        this.screenUnit = {x: frame.pixelsPerScreenUnitX, y: frame.pixelsPerScreenUnitY};
        this.presenter.present(frame);
    }

    private readonly fit = (): void => {
        const ratio = currentDevicePixelRatio();
        const scale = this.options.devicePixelsPerFramebufferPixel ?? defaultDevicePixelsPerFramebufferPixel(ratio);
        const bounds = this.shell.containerBounds();
        const widthPx = this.options.fixed?.widthPx ?? fittedPixels(bounds.width * ratio, scale);
        const heightPx = this.options.fixed?.heightPx ?? fittedPixels(bounds.height * ratio, scale);
        this.presenter.resize(widthPx, heightPx);
        const style = this.shell.canvas.style;
        style.width = `${widthPx * scale / ratio}px`;
        style.height = `${heightPx * scale / ratio}px`;
    };
}

export function pixelCanvasDisplayFromQuery(container: HTMLElement, search: string): PixelCanvasDisplay {
    return new PixelCanvasDisplay(container, {
        fixed: fixedFramebufferSizeFromQuery(search),
        devicePixelsPerFramebufferPixel: pixelScaleFromQuery(search),
    });
}
