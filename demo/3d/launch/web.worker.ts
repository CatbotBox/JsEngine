import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {CellPresenterResource} from "../../../src/backends/cells";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {projectFilePreload} from "../../../src/hosts/web/projectFilePreload";
import {installCellRendering3d} from "./cellRendering";
import {DEMO_3D_PROJECT_DIRECTORY, launchDemo3d} from "./demo3dLaunch";
import {manifestModelFiles, preloadDemo3dAssets} from "./webAssets";

runWorldWorker(async (page, files) => {
    const presenter = page.cellPresenter();
    const manifest = await preloadDemo3dAssets(page, files);

    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellPresenterResource(presenter));
    page.connectInput(world.resources.getOrCreate(Input));
    await launchDemo3d(world, {
        renderBackend: "cells",
        preload: projectFilePreload(files, DEMO_3D_PROJECT_DIRECTORY),
        installRendering: installCellRendering3d,
        modelFiles: manifestModelFiles(manifest, files),
        quit: () => page.quit(),
    });
    world.startLoop();
});
