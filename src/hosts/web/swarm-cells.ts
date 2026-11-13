import {startWorldPage} from "./worldPage";
import {cellCanvasDisplayFromQuery} from "./cellCanvasDisplay";

startWorldPage("worldswarm.worker.js", "Swarm", cellCanvasDisplayFromQuery);
