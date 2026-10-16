import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import {WebglAddon} from "@xterm/addon-webgl";
import type {FixedTerminalSize} from "../src/js_engine/platform/worldWorkerProtocol";

/** Set on `<body>` while the terminal does not have keyboard focus; the page's CSS shows a hint for it. */
const UNFOCUSED_CLASS = "terminal-unfocused";

/**
 * An xterm.js terminal in `container`, focused on click. A dimension `fixed` gives stays that
 * size; any other fits the container and refits on window resize.
 */
export function createTerminal(container: HTMLElement, fixed: FixedTerminalSize = {}): Terminal {
    const terminal = new Terminal({
        scrollback: 0,
        cursorInactiveStyle: "none",
        ...(fixed.columns === undefined ? {} : {cols: fixed.columns}),
        ...(fixed.rows === undefined ? {} : {rows: fixed.rows}),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    loadWebglRenderer(terminal);
    const resize = () => {
        if (fixed.columns === undefined && fixed.rows === undefined) {
            fit.fit();
            return;
        }
        const proposed = fit.proposeDimensions();
        const columns = fixed.columns ?? proposed?.cols ?? terminal.cols;
        const rows = fixed.rows ?? proposed?.rows ?? terminal.rows;
        if (!Number.isFinite(columns) || !Number.isFinite(rows)) return;
        if (columns !== terminal.cols || rows !== terminal.rows) terminal.resize(columns, rows);
    };
    resize();
    if (fixed.columns === undefined || fixed.rows === undefined) window.addEventListener("resize", resize);
    container.addEventListener("click", () => terminal.focus());
    trackFocus(terminal);
    terminal.focus();
    return terminal;
}

function trackFocus(terminal: Terminal): void {
    const textarea = terminal.textarea;
    if (textarea === undefined) return;
    const update = () => document.body.classList.toggle(UNFOCUSED_CLASS, document.activeElement !== textarea);
    textarea.addEventListener("focus", update);
    textarea.addEventListener("blur", update);
    update();
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
