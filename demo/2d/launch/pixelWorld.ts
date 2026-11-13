import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import type {PageConnection} from "../../../src/hosts/web/worldWorkerPlatform";
import {setupDemo2d} from "../game";
import {installPixelRendering2d} from "./pixelRendering";

export function createPixelWorld2d(page: PageConnection): DebugWorld {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new PixelPresenterResource(page.pixelPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    setupDemo2d(world, {
        render: installPixelRendering2d(world),
        quit: () => page.quit(),
    });
    return world;
}
