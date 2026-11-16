import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
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

    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new PixelPresenterResource(presenter));
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo3d(world, {
        renderBackend: "pixels",
        preload: projectFilePreload(files, DEMO_3D_PROJECT_DIRECTORY),
        installRendering: installPixelRendering3d,
        modelFiles: manifestModelFiles(manifest, files),
        quit: () => page.quit(),
    });
    return {world, manifest};
}
