import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import {WebglAddon} from "@xterm/addon-webgl";
import {consoleOverride} from "../src/js_engine/debugging";
import {originalConsole} from "../src/js_engine/debugging/originalConsole";

/** An xterm.js terminal filling `container`, refit on window resize, focused on click. */
export function createTerminal(container: HTMLElement): Terminal {
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

/**
 * The render pass detaches the real console while it owns the terminal. On a page the terminal
 * is not the console, so devtools keeps its own listener.
 */
export function keepDevtoolsConsole(): void {
    consoleOverride.addConsoleEventListener(Object.create(originalConsole));
}
