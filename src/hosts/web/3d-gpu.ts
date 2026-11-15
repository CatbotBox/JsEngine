import {startWorldPage} from "./worldPage";
import {gpuCanvasDisplayFromQuery} from "./gpuCanvasDisplay";

startWorldPage("world3d-gpu.worker.js", "the 3D demo (experimental WebGPU)", gpuCanvasDisplayFromQuery);
