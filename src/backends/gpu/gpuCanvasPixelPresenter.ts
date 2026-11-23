import type {PixelFrame} from "../pixels/pixelFrame";
import type {PixelPresenter, PixelPresenterSize} from "../pixels/pixelPresenter";
import type {GpuDeviceResource} from "./gpuDeviceResource";

export const MAX_GPU_FRAMES_IN_FLIGHT = 2;

export type ScreenUnitReport = (pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number) => void;

export class GpuCanvasPixelPresenter implements PixelPresenter {
    public readonly overlaysScene = true;

    public constructor(
        private readonly surface: Pick<PixelPresenter, "size" | "onResize">,
        private readonly gpu: GpuDeviceResource,
        private readonly reportScreenUnit: ScreenUnitReport,
    ) {
    }

    public size(): PixelPresenterSize {
        return this.surface.size();
    }

    public onResize(listener: () => void): () => void {
        return this.surface.onResize(listener);
    }

    public backlogged(): boolean {
        return this.gpu.frame.framesInFlight >= MAX_GPU_FRAMES_IN_FLIGHT;
    }

    public onPresented(listener: () => void): () => void {
        return this.gpu.frame.onPresented(listener);
    }

    public start(): void {
    }

    public stop(): void {
    }

    public dispose(): void {
        this.gpu.dispose();
    }

    public present(frame: PixelFrame): void {
        this.gpu.frame.finish(frame);
        this.reportScreenUnit(frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY);
    }
}
