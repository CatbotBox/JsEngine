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

/**
 * Atlas pages kept before the glyph atlas is cleared. xterm's WebGL atlas holds one glyph per
 * (char, fg, bg) and never evicts, so truecolor half-block frames add pages every frame; at
 * MAX_TEXTURE_IMAGE_UNITS pages (>= 8) it merges pages mid-frame and the cells already placed
 * that frame sample stale texture coordinates (horizontal smears). Clearing well below that
 * reuses the existing pages instead.
 */
const MAX_ATLAS_PAGES = 4;

function loadWebglRenderer(terminal: Terminal): void {
    try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        terminal.loadAddon(webgl);
        boundGlyphAtlas(webgl);
    } catch (error) {
        console.warn("WebGL renderer unavailable, using the default renderer:", error);
    }
}

function boundGlyphAtlas(webgl: WebglAddon): void {
    let pages = 1;
    let clearPending = false;
    webgl.onChangeTextureAtlas(() => pages = 1);
    webgl.onRemoveTextureAtlasCanvas(() => pages--);
    webgl.onAddTextureAtlasCanvas(() => {
        pages++;
        if (pages < MAX_ATLAS_PAGES || clearPending) return;
        clearPending = true;
        // Pages are added while a frame renders; clear after it, not under it.
        setTimeout(() => {
            clearPending = false;
            webgl.clearTextureAtlas();
        });
    });
}
