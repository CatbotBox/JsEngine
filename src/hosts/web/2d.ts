import {loadRenderBackendScript} from "./renderBackendBootstrap";
import {connectDevReload} from "./devReload";

loadRenderBackendScript({cells: "2d-cells.js", pixels: "2d-pixels.js"});
connectDevReload();
