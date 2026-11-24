import type {PixelFrame} from "../pixels/pixelFrame";
import type {PixelPresenter, PixelPresenterSize} from "../pixels/pixelPresenter";
import type {GpuDeviceResource} from "./gpuDeviceResource";
import type {GpuFrame} from "./gpuFrame";

export const MAX_GPU_FRAMES_IN_FLIGHT = 2;

export type ScreenUnitReport = (pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number) => void;

export type GpuCanvasSurfaceSize = Pick<PixelPresenter, "size" | "onResize">;

export type GpuCanvasPresenterFactory = (canvas: OffscreenCanvas, surface: GpuCanvasSurfaceSize, reportScreenUnit: ScreenUnitReport) => PixelPresenter;

export class GpuCanvasPixelPresenter implements PixelPresenter {
    public readonly overlaysScene = true;

    public constructor(
        private readonly surface: GpuCanvasSurfaceSize,
        private readonly gpu: GpuDeviceResource,
        private readonly reportScreenUnit: ScreenUnitReport,
        public readonly frame: GpuFrame = gpu.frame,
    ) {
    }

    public size(): PixelPresenterSize {
        return this.surface.size();
    }

    public onResize(listener: () => void): () => void {
        return this.surface.onResize(listener);
    }

    public backlogged(): boolean {
        return this.frame.framesInFlight >= MAX_GPU_FRAMES_IN_FLIGHT;
    }

    public onPresented(listener: () => void): () => void {
        return this.frame.onPresented(listener);
    }

    public start(): void {
    }

    public stop(): void {
    }

    public dispose(): void {
        if (this.frame === this.gpu.frame) this.gpu.dispose();
        else this.frame.dispose();
    }

    public present(frame: PixelFrame): void {
        this.frame.finish(frame);
        this.reportScreenUnit(frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY);
    }
}

export function gpuFrameOf(presenter: PixelPresenter): GpuFrame | undefined {
    return presenter instanceof GpuCanvasPixelPresenter ? presenter.frame : undefined;
}

export function gpuCanvasPresenterFactory(gpu: GpuDeviceResource): GpuCanvasPresenterFactory {
    return (canvas, surface, reportScreenUnit) => new GpuCanvasPixelPresenter(surface, gpu, reportScreenUnit, gpu.frameOn(canvas));
}
