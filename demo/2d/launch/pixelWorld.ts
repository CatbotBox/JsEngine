import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import type {PreloadedFileSource} from "../../../src/hosts/web/preloadedFileSource";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installPixelRendering2d} from "./pixelRendering";
import {DEMO_2D_PROJECT_DIRECTORY, launchDemo2d} from "./demo2dLaunch";

export async function createPixelWorld2d(page: PageConnection, files: PreloadedFileSource): Promise<DebugWorld> {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new PixelPresenterResource(page.pixelPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo2d(world, {
        renderBackend: "pixels",
        preload: projectFilePreload(files, DEMO_2D_PROJECT_DIRECTORY),
        installRendering: installPixelRendering2d,
        quit: () => page.quit(),
    });
    return world;
}
