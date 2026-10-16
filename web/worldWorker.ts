import {consoleOverride} from "../src/js_engine/debugging";
import {originalConsole} from "../src/js_engine/debugging/originalConsole";
import {PageConnection, PreloadedFileSource} from "../src/js_engine/platform";
import type {WorldWorkerScope} from "../src/js_engine/platform";

/**
 * The worker half of a demo page: waits for the page's `init`, then runs `start` with the
 * connection (its `platform` is the world's) and the file source the platform reads, empty until
 * `start` preloads into it. A failure in `start` is logged and shown on the page.
 */
export function runWorldWorker(start: (page: PageConnection, files: PreloadedFileSource) => void | Promise<void>): void {
    // The render pass detaches the real console while it owns the terminal. In a worker the
    // terminal is the page's, not the console, so devtools keeps a listener of its own.
    consoleOverride.addConsoleEventListener(Object.create(originalConsole));

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
