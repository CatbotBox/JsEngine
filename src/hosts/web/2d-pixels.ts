import {startWorldPage} from "./worldPage";
import {pixelCanvasDisplayFromQuery} from "./pixelCanvasDisplay";

startWorldPage("world2d-pixels.worker.js", "the 2D demo", pixelCanvasDisplayFromQuery);
