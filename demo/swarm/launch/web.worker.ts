import {App} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installCellRenderingSwarm} from "./cellRendering";
import {launchSwarm, SWARM_PROJECT_DIRECTORY} from "./swarmLaunch";

runWorldWorker(async (page, files) => {
    const world = new App({platform: page.platform}).createDebugWorld();
    const presenter = page.cellPresenter();
    page.connectInput(world.resources.getOrCreate(Input));
    await launchSwarm(world, {
        preload: projectFilePreload(files, SWARM_PROJECT_DIRECTORY),
        installRendering: () => installCellRenderingSwarm(world, presenter),
    });
    world.startLoop();
});
