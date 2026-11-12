import {consoleOverride} from "../src/js_engine/debugging";
import {originalConsole} from "../src/js_engine/debugging/originalConsole";
import {PageConnection, PreloadedFileSource} from "../src/js_engine/platform";
import type {WorldWorkerScope} from "../src/js_engine/platform";

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
