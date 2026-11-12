import {connectWorldWorker} from "../src/js_engine/platform/worldWorkerPage";
import {fixedTerminalSizeFromQuery, requestedRasterWorkersFromQuery} from "../src/js_engine/platform/worldWorkerProtocol";
import {createTerminal} from "./terminal";

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
        onQuit: () => window.close(),
    });
    window.addEventListener("pagehide", () => page.exit());
}
