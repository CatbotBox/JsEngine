import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {PreloadedFileSource} from "../../../src/hosts/web/preloadedFileSource";
import {setupDemo3d} from "../game";
import type {Demo3dManifest} from "../assets";
import {installPixelRendering3d} from "./pixelRendering";
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
    setupDemo3d(world, {
        render: installPixelRendering3d(world),
        listModels: () => manifest.models,
        modelFiles: manifestModelFiles(manifest, files),
        quit: () => page.quit(),
    });
    return {world, manifest};
}
