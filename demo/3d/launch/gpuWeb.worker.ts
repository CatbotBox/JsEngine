import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {createGpuWorld3d} from "./gpuWorld";

runWorldWorker(async (page, files) => {
    const {world} = await createGpuWorld3d(page, files);
    world.startLoop();
});
