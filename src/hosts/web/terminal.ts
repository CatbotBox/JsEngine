import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import {WebglAddon} from "@xterm/addon-webgl";
import type {FixedTerminalSize} from "./worldWorkerProtocol";

const UNFOCUSED_CLASS = "terminal-unfocused";

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

const ATLAS_RESET_PAGES = 8;
const BOLD_AS_NUMBER = 700;

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
        setTimeout(() => {
            resetPending = false;
            replaceGlyphAtlas(terminal, webgl);
        });
    });
}

function replaceGlyphAtlas(terminal: Terminal, webgl: WebglAddon): void {
    terminal.options.fontWeightBold = terminal.options.fontWeightBold === BOLD_AS_NUMBER ? "bold" : BOLD_AS_NUMBER;
    webgl.clearTextureAtlas();
}
