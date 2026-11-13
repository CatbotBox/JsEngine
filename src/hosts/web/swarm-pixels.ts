import {startWorldPage} from "./worldPage";
import {pixelCanvasDisplayFromQuery} from "./pixelCanvasDisplay";

startWorldPage("worldswarm-pixels.worker.js", "Swarm", pixelCanvasDisplayFromQuery);
