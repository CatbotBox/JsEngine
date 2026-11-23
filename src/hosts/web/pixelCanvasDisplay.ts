import {CanvasPixelPresenter} from "../../backends/pixels/canvas/canvasPixelPresenter";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {CanvasDisplayShell, currentDevicePixelRatio} from "./canvasDisplayShell";
import type {CellArea} from "./domInput";
import type {PixelWorldDisplay} from "./worldWorkerPage";
import {FIXED_FRAMEBUFFER_LIMITS, fixedFramebufferSizeFromQuery, PIXEL_SCALE_LIMITS, pixelScaleFromQuery} from "./worldWorkerProtocol";
import type {FixedFramebufferSize, PixelSurfaceSize} from "./worldWorkerProtocol";

export const PIXELATED_IMAGE_RENDERING = "pixelated";
export const NO_SCREEN_UNITS = 0;

const VISIBLE = true;

export interface PixelCanvasDisplayOptions {
    readonly fixed?: FixedFramebufferSize;
    readonly devicePixelsPerFramebufferPixel?: number;
}

export interface ScreenUnitPx {
    readonly x: number;
    readonly y: number;
}

export interface FramebufferFit {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly cssWidthPx: number;
    readonly cssHeightPx: number;
}

export interface ContainerSize {
    readonly width: number;
    readonly height: number;
}

function fittedPixels(availableDevicePx: number, devicePixelsPerFramebufferPixel: number): number {
    return Math.min(FIXED_FRAMEBUFFER_LIMITS.maxPx, Math.max(FIXED_FRAMEBUFFER_LIMITS.minPx, Math.floor(availableDevicePx / devicePixelsPerFramebufferPixel)));
}

function defaultDevicePixelsPerFramebufferPixel(devicePixelRatio: number): number {
    return Math.min(PIXEL_SCALE_LIMITS.max, Math.max(PIXEL_SCALE_LIMITS.min, Math.round(devicePixelRatio)));
}

export function fitFramebuffer(container: ContainerSize, devicePixelRatio: number, options: PixelCanvasDisplayOptions): FramebufferFit {
    const scale = options.devicePixelsPerFramebufferPixel ?? defaultDevicePixelsPerFramebufferPixel(devicePixelRatio);
    const widthPx = options.fixed?.widthPx ?? fittedPixels(container.width * devicePixelRatio, scale);
    const heightPx = options.fixed?.heightPx ?? fittedPixels(container.height * devicePixelRatio, scale);
    return {widthPx, heightPx, cssWidthPx: widthPx * scale / devicePixelRatio, cssHeightPx: heightPx * scale / devicePixelRatio};
}

export function pixelCanvasDisplayOptionsFromQuery(search: string, defaultPixelScale?: number): PixelCanvasDisplayOptions {
    return {
        fixed: fixedFramebufferSizeFromQuery(search),
        devicePixelsPerFramebufferPixel: pixelScaleFromQuery(search) ?? defaultPixelScale,
    };
}

export class PixelCanvasDisplay implements PixelWorldDisplay {
    private readonly shell: CanvasDisplayShell<PixelFrame>;
    private readonly presenter: CanvasPixelPresenter<ImageData>;
    private screenUnit: ScreenUnitPx | undefined;

    public constructor(container: HTMLElement, private readonly options: PixelCanvasDisplayOptions = {}, visible: boolean = VISIBLE) {
        this.shell = new CanvasDisplayShell<PixelFrame>(container, frame => this.draw(frame));
        this.shell.canvas.style.imageRendering = PIXELATED_IMAGE_RENDERING;
        this.presenter = new CanvasPixelPresenter<ImageData>({canvas: this.shell.canvas, context: this.shell.context2d()});
        this.shell.mount(this.fit, visible);
    }

    public show(): void {
        this.shell.show();
    }

    public hide(): void {
        this.shell.hide();
    }

    public dispose(): void {
        this.shell.dispose();
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

    public hideStatus(): void {
        this.shell.hideStatus();
    }

    public showError(text: string): void {
        this.shell.showError(text);
    }

    // The screen unit comes from the last drawn frame, so before the first frame the area is 0x0 units.
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
        const fitted = fitFramebuffer(this.shell.containerBounds(), currentDevicePixelRatio(), this.options);
        this.presenter.resize(fitted.widthPx, fitted.heightPx);
        const style = this.shell.canvas.style;
        style.width = `${fitted.cssWidthPx}px`;
        style.height = `${fitted.cssHeightPx}px`;
    };
}

export function pixelCanvasDisplayFromQuery(container: HTMLElement, search: string, visible: boolean = VISIBLE, defaultPixelScale?: number): PixelCanvasDisplay {
    return new PixelCanvasDisplay(container, pixelCanvasDisplayOptionsFromQuery(search, defaultPixelScale), visible);
}

export function pixelCanvasDisplayScaledBy(pixelScale: number): (container: HTMLElement, search: string) => PixelCanvasDisplay {
    return (container, search) => pixelCanvasDisplayFromQuery(container, search, VISIBLE, pixelScale);
}
