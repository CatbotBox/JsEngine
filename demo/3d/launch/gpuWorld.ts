import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import {gpuCanvasPresenter, requestGpuDevice} from "../../../src/hosts/web/gpuWorldDevice";
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

export async function createGpuWorld3d(page: PageConnection, files: PreloadedFileSource): Promise<GpuWorld3d> {
    const gpu = await requestGpuDevice(page);
    const presenter = gpuCanvasPresenter(page, gpu);
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
