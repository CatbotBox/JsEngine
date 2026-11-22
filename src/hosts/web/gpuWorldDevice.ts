import {GpuCanvasPixelPresenter, GpuDeviceResource} from "../../backends/gpu";
import type {GpuEntryPoint} from "../../backends/gpu";
import {optionalFeature} from "../../engine/platform/platform";
import type {PageConnection} from "./worldWorkerPlatform";

export function webGpuUnavailableMessage(reason: string): string {
    return `WebGPU is unavailable in the world worker (${reason}); open the page with ?backend=pixels`;
}

function workerGpu(): GpuEntryPoint | undefined {
    return optionalFeature("gpu", () => (globalThis as {navigator?: {gpu?: GpuEntryPoint}}).navigator?.gpu);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function requestGpuDevice(page: PageConnection): Promise<GpuDeviceResource> {
    const gpu = workerGpu();
    if (gpu === undefined) throw new Error(webGpuUnavailableMessage("navigator.gpu is missing"));
    const canvas = page.gpuCanvas();
    try {
        return await GpuDeviceResource.request(canvas, gpu, message => page.fail(message));
    } catch (error) {
        throw new Error(webGpuUnavailableMessage(messageOf(error)));
    }
}

export function gpuCanvasPresenter(page: PageConnection, gpu: GpuDeviceResource): GpuCanvasPixelPresenter {
    return new GpuCanvasPixelPresenter(page.pixelPresenter(), gpu, (x, y) => page.showScreenUnit(x, y));
}
