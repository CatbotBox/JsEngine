import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {CellPresenterResource} from "../../../src/backends/cells";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installCellRendering2d} from "./cellRendering";
import {DEMO_2D_PROJECT_DIRECTORY, launchDemo2d} from "./demo2dLaunch";

runWorldWorker(async (page, files) => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellPresenterResource(page.cellPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo2d(world, {
        renderBackend: "cells",
        preload: projectFilePreload(files, DEMO_2D_PROJECT_DIRECTORY),
        installRendering: installCellRendering2d,
        quit: () => page.quit(),
    });
    world.startLoop();
});
