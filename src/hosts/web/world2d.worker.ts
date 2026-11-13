import {DebugWorld} from "../../engine/core";
import {Input} from "../../engine/input";
import {CellSurfaceResource} from "../../backends/cells";
import {setupDemo2d} from "../../../demo/2d/game";
import {runWorldWorker} from "./worldWorker";

runWorldWorker(page => {
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new CellSurfaceResource(page.terminal));
    page.connectInput(world.resources.getOrCreate(Input));
    setupDemo2d(world, {
        quit: () => page.quit(),
    });
    world.startLoop();
});
