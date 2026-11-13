import type {FileSource, Platform} from "../../engine/platform/platform";
import type {CellSurface} from "../../backends/cells/cellSurface";
import {inflate} from "../../engine/assets/image/inflate";

export interface TerminalSubscription {
    dispose(): void;
}

export interface BrowserTerminal {
    readonly cols: number;
    readonly rows: number;
    write(data: string): void;
    onResize(listener: (size: {cols: number, rows: number}) => void): TerminalSubscription;
}

interface BrowserHost {
    readonly navigator?: {readonly hardwareConcurrency?: number};
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
}

const EXIT_EVENTS = ["pagehide", "beforeunload"] as const;

export function browserPlatform(files: FileSource): Platform {
    const host = globalThis as unknown as BrowserHost;
    return {
        files,
        inflate,
        hardwareConcurrency: () => host.navigator?.hardwareConcurrency ?? 1,
        now: () => performance.now(),
        onExit: callback => onPageExit(host, callback),
    };
}

export function worldTerminal(terminal: BrowserTerminal): CellSurface {
    return {
        write(chunk: string): void {
            terminal.write(chunk);
        },
        ...createTerminalScreen(terminal),
    };
}

function createTerminalScreen(terminal: BrowserTerminal): Pick<CellSurface, "size" | "onResize"> {
    return {
        size: () => ({columns: terminal.cols, rows: terminal.rows}),
        onResize(callback: () => void): () => void {
            const subscription = terminal.onResize(() => callback());
            return () => subscription.dispose();
        },
    };
}

function onPageExit(host: BrowserHost, callback: () => void): () => void {
    const cancel = (): void => {
        for (const type of EXIT_EVENTS) host.removeEventListener?.(type, run);
    };
    const run = (): void => {
        cancel();
        callback();
    };
    for (const type of EXIT_EVENTS) host.addEventListener?.(type, run);
    return cancel;
}
