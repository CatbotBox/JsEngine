import {runWorldWorker} from "../../../src/hosts/web/worldWorker";
import {createPixelWorld2d} from "./pixelWorld";

runWorldWorker(page => {
    createPixelWorld2d(page).startLoop();
});
