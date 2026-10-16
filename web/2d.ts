import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import {WebglAddon} from "@xterm/addon-webgl";
import {DebugWorld} from "../src/js_engine/core";
import {browserPlatform, PreloadedFileSource} from "../src/js_engine/platform";
import {consoleInput} from "../src/js_engine/input";
import {consoleOverride} from "../src/js_engine/debugging";
import {originalConsole} from "../src/js_engine/debugging/originalConsole";
import {setupDemo2d} from "../demo/2d/game";

/** The 2D demo draws its sprites in code; nothing to fetch. */
const ASSETS: readonly string[] = [];

function createTerminal(container: HTMLElement): Terminal {
    const terminal = new Terminal({scrollback: 0, cursorInactiveStyle: "none"});
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    loadWebglRenderer(terminal);
    fit.fit();
    window.addEventListener("resize", () => fit.fit());
    container.addEventListener("click", () => terminal.focus());
    terminal.focus();
    return terminal;
}

function loadWebglRenderer(terminal: Terminal): void {
    try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        terminal.loadAddon(webgl);
    } catch (error) {
        console.warn("WebGL renderer unavailable, using the default renderer:", error);
    }
}

async function main(): Promise<void> {
    // The render pass detaches the real console while it owns the terminal. On a page the
    // terminal is not the console, so devtools keeps its own listener.
    consoleOverride.addConsoleEventListener(Object.create(originalConsole));

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
