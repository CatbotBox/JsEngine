import {App} from "../../../src/engine/core";
import type {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {gpuCanvasPresenter, requestGpuDevice} from "../../../src/hosts/web/gpuWorldDevice";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {PreloadedFileSource} from "../../../src/hosts/web/preloadedFileSource";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import type {Demo3dManifest} from "../assets";
import {installGpuRendering3d} from "./gpuRendering";
import {DEMO_3D_PROJECT_DIRECTORY, launchDemo3d} from "./demo3dLaunch";
import {manifestModelFiles, preloadDemo3dAssets} from "./webAssets";

export interface GpuWorld3d {
    readonly world: DebugWorld;
    readonly manifest: Demo3dManifest;
}

export async function createGpuWorld3d(page: PageConnection, files: PreloadedFileSource): Promise<GpuWorld3d> {
    const gpu = await requestGpuDevice(page);
    const presenter = gpuCanvasPresenter(page, gpu);
    const manifest = await preloadDemo3dAssets(page, files);

    const world = new App({platform: page.platform}).createDebugWorld();
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo3d(world, {
        preload: projectFilePreload(files, DEMO_3D_PROJECT_DIRECTORY),
        installRendering: () => installGpuRendering3d(world, gpu, presenter),
        modelFiles: manifestModelFiles(manifest, files),
    });
    return {world, manifest};
}
