/**
 * Messages between a page and the dedicated worker its world runs in. The page owns the terminal;
 * the worker owns the world and reaches the terminal only through these messages. `init` is
 * always the page's first message.
 */

export interface InitMessage {
    readonly type: "init";
    /** The terminal's size when the worker starts; every later change arrives as `resize`. */
    readonly columns: number;
    readonly rows: number;
    /** Raster worker threads the page asks for (`?threads=N`); absent: the worker decides from its cores. */
    readonly requestedRasterWorkers?: number;
}

export type PageToWorldMessage =
    | InitMessage
    /** Raw terminal bytes typed by the user, escape sequences included. */
    | {readonly type: "input", readonly data: string}
    | {readonly type: "resize", readonly columns: number, readonly rows: number}
    /** The page has handed one `output` message to its terminal and the terminal has parsed it. */
    | {readonly type: "written"}
    /** The page is going away (pagehide). */
    | {readonly type: "exit"};

export type WorldToPageMessage =
    /** Everything the world wrote to its terminal during one task: a whole frame, never part of one. */
    | {readonly type: "output", readonly data: string}
    /** The user stopped the world (Ctrl+C, Escape); sent after the world's last output. */
    | {readonly type: "quit"}
    /** The world could not start or crashed outside a system; sent after the world's last output. */
    | {readonly type: "error", readonly message: string};

const PAGE_TO_WORLD_TYPES: ReadonlySet<string> = new Set(["init", "input", "resize", "written", "exit"]);
const WORLD_TO_PAGE_TYPES: ReadonlySet<string> = new Set(["output", "quit", "error"]);

function hasType(message: unknown, types: ReadonlySet<string>): boolean {
    return typeof message === "object" && message !== null && types.has((message as {type?: unknown}).type as string);
}

export function isPageToWorldMessage(message: unknown): message is PageToWorldMessage {
    return hasType(message, PAGE_TO_WORLD_TYPES);
}

export function isWorldToPageMessage(message: unknown): message is WorldToPageMessage {
    return hasType(message, WORLD_TO_PAGE_TYPES);
}

/** `?threads=N` from a page's query string: a whole number >= 0, else undefined. */
export function requestedRasterWorkersFromQuery(search: string): number | undefined {
    return wholeNumberFromQuery(search, "threads", 0, Number.POSITIVE_INFINITY);
}

/** Each dimension given is fixed; an absent one fits the window. */
export interface FixedTerminalSize {
    readonly columns?: number;
    readonly rows?: number;
}

export const FIXED_TERMINAL_LIMITS = {minColumns: 10, minRows: 5, max: 1000} as const;

/**
 * `?cols=C&rows=R` from a page's query string, for a page embedded at a known size: each a whole
 * number within FIXED_TERMINAL_LIMITS, anything else is left out (and so fits the window).
 */
export function fixedTerminalSizeFromQuery(search: string): FixedTerminalSize {
    const columns = wholeNumberFromQuery(search, "cols", FIXED_TERMINAL_LIMITS.minColumns, FIXED_TERMINAL_LIMITS.max);
    const rows = wholeNumberFromQuery(search, "rows", FIXED_TERMINAL_LIMITS.minRows, FIXED_TERMINAL_LIMITS.max);
    return {
        ...(columns === undefined ? {} : {columns}),
        ...(rows === undefined ? {} : {rows}),
    };
}

function wholeNumberFromQuery(search: string, name: string, min: number, max: number): number | undefined {
    const value = new URLSearchParams(search).get(name);
    if (value === null || !/^\d+$/.test(value.trim())) return undefined;
    const number = Number.parseInt(value, 10);
    return number >= min && number <= max ? number : undefined;
}
