export interface InitMessage {
    readonly type: "init";
    readonly columns: number;
    readonly rows: number;
    readonly requestedRasterWorkers?: number;
}

export type PageToWorldMessage =
    | InitMessage
    | {readonly type: "input", readonly data: string}
    | {readonly type: "resize", readonly columns: number, readonly rows: number}
    | {readonly type: "written"}
    | {readonly type: "exit"};

export type WorldToPageMessage =
    | {readonly type: "output", readonly data: string}
    | {readonly type: "quit"}
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

export function requestedRasterWorkersFromQuery(search: string): number | undefined {
    return wholeNumberFromQuery(search, "threads", 0, Number.POSITIVE_INFINITY);
}

export interface FixedTerminalSize {
    readonly columns?: number;
    readonly rows?: number;
}

export const FIXED_TERMINAL_LIMITS = {minColumns: 10, minRows: 5, max: 1000} as const;

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
