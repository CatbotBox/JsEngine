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
 * xterm's WebGL glyph atlas caches one glyph per (char, fg, bg) and never evicts, so truecolor
 * half-block frames (a fading pixel is a new colour pair every few frames) keep adding pages. At
 * MAX_TEXTURE_IMAGE_UNITS pages (16 under WebGL2) it merges pages in the middle of a frame, and
 * cells already placed sample stale texture coordinates: sprites vanish or smear across the row.
 * Swapping in a fresh atlas between frames once it holds this many pages keeps it from merging.
 */
const ATLAS_RESET_PAGES = 8;

function loadWebglRenderer(terminal: Terminal): void {
    try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        terminal.loadAddon(webgl);
        boundGlyphAtlas(terminal, webgl);
    } catch (error) {
        console.warn("WebGL renderer unavailable, using the default renderer:", error);
    }
}

function boundGlyphAtlas(terminal: Terminal, webgl: WebglAddon): void {
    let pages = 1;
    let resetPending = false;
    webgl.onChangeTextureAtlas(() => pages = 1);
    webgl.onRemoveTextureAtlasCanvas(() => pages--);
    webgl.onAddTextureAtlasCanvas(() => {
        if (++pages < ATLAS_RESET_PAGES || resetPending) return;
        resetPending = true;
        // Pages are added while a frame renders; replace the atlas after it, not under it.
        setTimeout(() => {
            resetPending = false;
            replaceGlyphAtlas(terminal, webgl);
        });
    });
}

/**
 * clearTextureAtlas() keeps every page (and skips the clear whenever page 0 happens to be
 * empty), so it cannot shrink the atlas. Atlases are cached by the options they render with and a
 * terminal's old one is disposed when its options stop matching, so alternating fontWeightBold
 * between two spellings of the same weight yields a fresh one-page atlas; clearTextureAtlas()
 * then drops the render model's references into the old one.
 */
function replaceGlyphAtlas(terminal: Terminal, webgl: WebglAddon): void {
    terminal.options.fontWeightBold = terminal.options.fontWeightBold === 700 ? "bold" : 700;
    webgl.clearTextureAtlas();
}
