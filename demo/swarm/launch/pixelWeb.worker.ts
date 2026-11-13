import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {setupSwarm} from "../game";
import {installPixelRenderingSwarm} from "./pixelRendering";

runWorldWorker(page => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new PixelPresenterResource(page.pixelPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    setupSwarm(world, {
        render: installPixelRenderingSwarm(world),
        quit: () => page.quit(),
    });
    world.startLoop();
});
