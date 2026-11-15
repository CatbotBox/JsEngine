import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import {GpuCanvasPixelPresenter, GpuDeviceResource} from "../../../src/backends/gpu";
import type {GpuEntryPoint} from "../../../src/backends/gpu";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {PreloadedFileSource} from "../../../src/hosts/web/preloadedFileSource";
import {setupDemo3d} from "../game";
import type {Demo3dManifest} from "../assets";
import {installGpuRendering3d} from "./gpuRendering";
import {manifestModelFiles, preloadDemo3dAssets} from "./webAssets";

export interface GpuWorld3d {
    readonly world: DebugWorld;
    readonly manifest: Demo3dManifest;
}

export function webGpuUnavailableMessage(reason: string): string {
    return `WebGPU is unavailable in the world worker (${reason}); open the page with ?backend=pixels`;
}

function workerGpu(): GpuEntryPoint | undefined {
    return (globalThis as {navigator?: {gpu?: GpuEntryPoint}}).navigator?.gpu;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function requestGpuDevice(page: PageConnection): Promise<GpuDeviceResource> {
    const gpu = workerGpu();
    if (gpu === undefined) throw new Error(webGpuUnavailableMessage("navigator.gpu is missing"));
    const canvas = page.gpuCanvas();
    try {
        return await GpuDeviceResource.request(canvas, gpu, message => page.fail(message));
    } catch (error) {
        throw new Error(webGpuUnavailableMessage(messageOf(error)));
    }
}

export async function createGpuWorld3d(page: PageConnection, files: PreloadedFileSource): Promise<GpuWorld3d> {
    const gpu = await requestGpuDevice(page);
    const presenter = new GpuCanvasPixelPresenter(page.pixelPresenter(), gpu, (x, y) => page.showScreenUnit(x, y));
    const manifest = await preloadDemo3dAssets(page, files);

    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(gpu);
    world.resources.insert(new PixelPresenterResource(presenter));
    page.connectInput(world.resources.getOrCreate(Input));
    setupDemo3d(world, {
        render: installGpuRendering3d(world),
        listModels: () => manifest.models,
        modelFiles: manifestModelFiles(manifest, files),
        quit: () => page.quit(),
    });
    return {world, manifest};
}
