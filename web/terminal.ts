import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import {WebglAddon} from "@xterm/addon-webgl";

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
