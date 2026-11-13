import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {createPixelWorld3d} from "./pixelWorld";

runWorldWorker(async (page, files) => {
    const {world} = await createPixelWorld3d(page, files);
    world.startLoop();
});
