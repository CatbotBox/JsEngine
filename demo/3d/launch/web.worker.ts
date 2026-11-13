import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {CellPresenterResource} from "../../../src/backends/cells";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {setupDemo3d} from "../game";
import {installCellRendering3d} from "./cellRendering";
import {manifestModelFiles, preloadDemo3dAssets} from "./webAssets";

runWorldWorker(async (page, files) => {
    const presenter = page.cellPresenter();
    const manifest = await preloadDemo3dAssets(page, files);

    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellPresenterResource(presenter));
    page.connectInput(world.resources.getOrCreate(Input));
    setupDemo3d(world, {
        render: installCellRendering3d(world),
        listModels: () => manifest.models,
        modelFiles: manifestModelFiles(manifest, files),
        quit: () => page.quit(),
    });
    world.startLoop();
});
