import type {FileSource, Platform, PlatformInput, PlatformScreen} from "./platform";
import {inflate} from "../rendering/3d/image/inflate";

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

interface BrowserHost {
    readonly navigator?: {readonly hardwareConcurrency?: number};
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
}

const EXIT_EVENTS = ["pagehide", "beforeunload"] as const;

export function browserPlatform(terminal: BrowserTerminal, files: FileSource): Platform {
    const host = globalThis as unknown as BrowserHost;
    return {
        output: {
            write(chunk: string): void {
                terminal.write(chunk);
            },
        },
        input: createTerminalInput(terminal),
        screen: createTerminalScreen(terminal),
        files,
        inflate,
        hardwareConcurrency: () => host.navigator?.hardwareConcurrency ?? 1,
        now: () => performance.now(),
        onExit: callback => onPageExit(host, callback),
    };
}

function createTerminalInput(terminal: BrowserTerminal): PlatformInput {
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

function createTerminalScreen(terminal: BrowserTerminal): PlatformScreen {
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
