import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {createPixelWorld2d} from "./pixelWorld";

runWorldWorker(async (page, files) => {
    const world = await createPixelWorld2d(page, files);
    world.startLoop();
});
