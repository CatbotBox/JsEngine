import {loadRenderBackendScript} from "./renderBackendBootstrap";
import {connectDevReload} from "./devReload";

loadRenderBackendScript({cells: "swarm-cells.js", pixels: "swarm-pixels.js"}, {defaultBackend: "pixels"});
connectDevReload();
