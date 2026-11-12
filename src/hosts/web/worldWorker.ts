import {consoleOverride} from "../../engine/debugging";
import {originalConsole} from "../../engine/debugging/originalConsole";
import {PageConnection} from "./worldWorkerPlatform";
import {PreloadedFileSource} from "./preloadedFileSource";
import type {WorldWorkerScope} from "./worldWorkerPlatform";

export function runWorldWorker(start: (page: PageConnection, files: PreloadedFileSource) => void | Promise<void>): void {
    keepDevtoolsConsoleListening();

    const files = new PreloadedFileSource();
    void PageConnection.open(globalThis as unknown as WorldWorkerScope, files).then(async page => {
        try {
            await start(page, files);
        } catch (error) {
            console.error(error);
            page.fail(error);
        }
    });
}

function keepDevtoolsConsoleListening(): void {
    consoleOverride.addConsoleEventListener(Object.create(originalConsole));
}
