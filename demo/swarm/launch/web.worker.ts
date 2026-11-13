import {DebugWorld} from "../../../src/engine/core";
import {Input} from "../../../src/engine/input";
import {CellPresenterResource} from "../../../src/backends/cells";
import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {setupSwarm} from "../game";
import {installCellRenderingSwarm} from "./cellRendering";

runWorldWorker(page => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellPresenterResource(page.cellPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    setupSwarm(world, {
        render: installCellRenderingSwarm(world),
        quit: () => page.quit(),
    });
    world.startLoop();
});
