import {connectWorldWorker} from "./worldWorkerPage";
import type {WorldDisplay} from "./worldWorkerPage";
import {projectPathsIn, siteFolderOf, takeDevDataAssetsChanges} from "./devReload";
import {requestedRasterWorkersFromQuery} from "./worldWorkerProtocol";
import {installDomInput} from "./domInput";
import type {CellArea} from "./domInput";

declare const JSENGINE_DEV_RELOAD: boolean;

export type PageDisplay = WorldDisplay & {cellArea(): CellArea};

export type PageDisplayFactory = (container: HTMLElement, search: string) => PageDisplay;

export function startWorldPage(workerUrl: string, name: string, createDisplay: PageDisplayFactory): void {
    const play = document.getElementById("play")!;
    play.addEventListener("click", () => {
        play.remove();
        start(workerUrl, name, createDisplay);
    }, {once: true});
}

function start(workerUrl: string, name: string, createDisplay: PageDisplayFactory): void {
    const container = document.getElementById("terminal")!;
    const display = createDisplay(container, location.search);
    const worker = new Worker(workerUrl, {type: "module"});
    const page = connectWorldWorker(display, worker, {
        name,
        requestedRasterWorkers: requestedRasterWorkersFromQuery(location.search),
        onQuit: () => window.close(),
    });
    installDomInput(container, {sink: page.input, cellArea: () => display.cellArea()});
    window.addEventListener("pagehide", () => page.exit());
    if (typeof JSENGINE_DEV_RELOAD === "undefined" || !JSENGINE_DEV_RELOAD) return;
    const siteFolder = siteFolderOf(workerUrl, location.href);
    takeDevDataAssetsChanges(window, change => page.reloadDataAssets(projectPathsIn(siteFolder, change.paths)));
}
