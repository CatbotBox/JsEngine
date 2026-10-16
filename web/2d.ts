import {DebugWorld} from "../src/js_engine/core";
import {browserPlatform, PreloadedFileSource} from "../src/js_engine/platform";
import {consoleInput} from "../src/js_engine/input";
import {setupDemo2d} from "../demo/2d/game";
import {createTerminal, keepDevtoolsConsole} from "./terminal";

/** The 2D demo draws its sprites in code; nothing to fetch. */
const ASSETS: readonly string[] = [];

async function main(): Promise<void> {
    keepDevtoolsConsole();

    const terminal = createTerminal(document.getElementById("terminal")!);
    const files = new PreloadedFileSource();
    await files.preload(ASSETS);

    const world = new DebugWorld({platform: browserPlatform(terminal, files)});
    setupDemo2d(world, {
        quit: () => {
            consoleInput.disable();
            terminal.write("\x1b[0m\r\nStopped. Reload the page to restart.\r\n");
        },
    });
    world.startLoop();
}

void main();
