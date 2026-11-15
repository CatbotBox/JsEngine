import {loadRenderBackendScript} from "./renderBackendBootstrap";
import {connectDevReload} from "./devReload";

loadRenderBackendScript({cells: "3d-cells.js", pixels: "3d-pixels.js", gpu: "3d-gpu.js"});
connectDevReload();
