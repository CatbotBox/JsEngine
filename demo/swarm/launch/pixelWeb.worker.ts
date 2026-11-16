import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {PixelPresenterResource} from "../../../src/backends/pixels";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installPixelRenderingSwarm} from "./pixelRendering";
import {launchSwarm, SWARM_PROJECT_DIRECTORY} from "./swarmLaunch";

runWorldWorker(async (page, files) => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new PixelPresenterResource(page.pixelPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    await launchSwarm(world, {
        renderBackend: "pixels",
        preload: projectFilePreload(files, SWARM_PROJECT_DIRECTORY),
        installRendering: installPixelRenderingSwarm,
        quit: () => page.quit(),
    });
    world.startLoop();
});
