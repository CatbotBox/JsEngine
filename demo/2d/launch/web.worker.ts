import {App} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installCellRendering2d} from "./cellRendering";
import {DEMO_2D_PROJECT_DIRECTORY, launchDemo2d} from "./demo2dLaunch";

runWorldWorker(async (page, files) => {
    const world = new App({platform: page.platform}).createDebugWorld();
    const presenter = page.cellPresenter();
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo2d(world, {
        preload: projectFilePreload(files, DEMO_2D_PROJECT_DIRECTORY),
        installRendering: () => installCellRendering2d(world, presenter),
    });
    world.startLoop();
});
