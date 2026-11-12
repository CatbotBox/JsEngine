import type {FileSource, Platform} from "../../engine/platform/platform";
import type {TerminalInputSource} from "../../engine/input/terminalInputSource";
import type {CellSurface} from "../../backends/cells/cellSurface";
import {inflate} from "../../engine/assets/image/inflate";

export interface TerminalSubscription {
    dispose(): void;
}

export interface BrowserTerminal {
    readonly cols: number;
    readonly rows: number;
    write(data: string): void;
    onData(listener: (data: string) => void): TerminalSubscription;
    onResize(listener: (size: {cols: number, rows: number}) => void): TerminalSubscription;
}

export type WorldTerminal = CellSurface & TerminalInputSource;

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

export function worldTerminal(terminal: BrowserTerminal): WorldTerminal {
    return {
        write(chunk: string): void {
            terminal.write(chunk);
        },
        ...createTerminalInput(terminal),
        ...createTerminalScreen(terminal),
    };
}

function createTerminalInput(terminal: BrowserTerminal): Omit<TerminalInputSource, "write"> {
    let subscription: TerminalSubscription | undefined;
    const stop = (): void => {
        subscription?.dispose();
        subscription = undefined;
    };
    return {
        available: () => true,
        start(onData: (data: string) => void): void {
            stop();
            subscription = terminal.onData(onData);
        },
        stop,
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
