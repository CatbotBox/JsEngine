import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {CellPresenterResource} from "../../../src/backends/cells";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installCellRenderingSwarm} from "./cellRendering";
import {launchSwarm, SWARM_PROJECT_DIRECTORY} from "./swarmLaunch";

runWorldWorker(async (page, files) => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellPresenterResource(page.cellPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    await launchSwarm(world, {
        renderBackend: "cells",
        preload: projectFilePreload(files, SWARM_PROJECT_DIRECTORY),
        installRendering: installCellRenderingSwarm,
        quit: () => page.quit(),
    });
    world.startLoop();
});
