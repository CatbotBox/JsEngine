// Deep imports, not the platform barrel: through the barrel the page bundle keeps engine modules
// with load-time side effects (the inflate tables), and the page runs no engine code at all.
import {connectWorldWorker} from "../src/js_engine/platform/worldWorkerPage";
import {fixedTerminalSizeFromQuery, requestedRasterWorkersFromQuery} from "../src/js_engine/platform/worldWorkerProtocol";
import {createTerminal} from "./terminal";

/**
 * The page half of a demo. Nothing heavy happens until the `#play` button is pressed: then the
 * terminal opens in `#terminal` and the world starts in the module worker at `workerUrl`
 * (relative to the page). `?threads=N` asks the world for N raster workers; `?cols=C` / `?rows=R`
 * fix the terminal's size (for an iframe embed) instead of fitting it to the window.
 */
export function startWorldPage(workerUrl: string, name: string): void {
    const play = document.getElementById("play")!;
    play.addEventListener("click", () => {
        play.remove();
        start(workerUrl, name);
    }, {once: true});
}

function start(workerUrl: string, name: string): void {
    const terminal = createTerminal(document.getElementById("terminal")!, fixedTerminalSizeFromQuery(location.search));
    terminal.write(`Starting ${name}...\r\n`);
    const worker = new Worker(workerUrl, {type: "module"});
    const page = connectWorldWorker(terminal, worker, {
        name,
        requestedRasterWorkers: requestedRasterWorkersFromQuery(location.search),
    });
    window.addEventListener("pagehide", () => page.exit());
}
