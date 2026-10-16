// Deep imports, not the platform barrel: through the barrel the page bundle keeps engine modules
// with load-time side effects (the inflate tables), and the page runs no engine code at all.
import {connectWorldWorker} from "../src/js_engine/platform/worldWorkerPage";
import {requestedRasterWorkersFromQuery} from "../src/js_engine/platform/worldWorkerProtocol";
import {createTerminal} from "./terminal";

/**
 * The page half of a demo: the terminal lives here, the world in the module worker at
 * `workerUrl` (relative to the page). `?threads=N` asks the world for N raster workers.
 */
export function startWorldPage(workerUrl: string, name: string): void {
    const terminal = createTerminal(document.getElementById("terminal")!);
    const worker = new Worker(workerUrl, {type: "module"});
    const page = connectWorldWorker(terminal, worker, {
        name,
        requestedRasterWorkers: requestedRasterWorkersFromQuery(location.search),
    });
    window.addEventListener("pagehide", () => page.exit());
}
