import {startWorldPage} from "./worldPage";
import {pixelCanvasDisplayFromQuery} from "./pixelCanvasDisplay";

startWorldPage("world3d-pixels.worker.js", "the 3D demo", pixelCanvasDisplayFromQuery);
