import {connectWorldWorker} from "./worldWorkerPage";
import {fixedTerminalSizeFromQuery, requestedRasterWorkersFromQuery} from "./worldWorkerProtocol";
import {createTerminal, terminalCellArea} from "./terminal";
import {installDomInput} from "./domInput";

export function startWorldPage(workerUrl: string, name: string): void {
    const play = document.getElementById("play")!;
    play.addEventListener("click", () => {
        play.remove();
        start(workerUrl, name);
    }, {once: true});
}

function start(workerUrl: string, name: string): void {
    const container = document.getElementById("terminal")!;
    const terminal = createTerminal(container, fixedTerminalSizeFromQuery(location.search));
    terminal.write(`Starting ${name}...\r\n`);
    const worker = new Worker(workerUrl, {type: "module"});
    const page = connectWorldWorker(terminal, worker, {
        name,
        requestedRasterWorkers: requestedRasterWorkersFromQuery(location.search),
        onQuit: () => window.close(),
    });
    installDomInput(container, {sink: page.input, cellArea: () => terminalCellArea(terminal, container)});
    window.addEventListener("pagehide", () => page.exit());
}
