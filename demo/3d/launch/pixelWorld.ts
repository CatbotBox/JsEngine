import {App} from "../../../src/engine/core";
import type {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {PreloadedFileSource} from "../../../src/hosts/web/preloadedFileSource";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import type {Demo3dManifest} from "../assets";
import {installPixelRendering3d} from "./pixelRendering";
import {DEMO_3D_PROJECT_DIRECTORY, launchDemo3d} from "./demo3dLaunch";
import {manifestModelFiles, preloadDemo3dAssets} from "./webAssets";

export interface PixelWorld3d {
    readonly world: DebugWorld;
    readonly manifest: Demo3dManifest;
}

export async function createPixelWorld3d(page: PageConnection, files: PreloadedFileSource): Promise<PixelWorld3d> {
    const presenter = page.pixelPresenter();
    const manifest = await preloadDemo3dAssets(page, files);

    const world = new App({platform: page.platform}).createDebugWorld();
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo3d(world, {
        preload: projectFilePreload(files, DEMO_3D_PROJECT_DIRECTORY),
        installRendering: () => installPixelRendering3d(world, presenter),
        modelFiles: manifestModelFiles(manifest, files),
    });
    return {world, manifest};
}
