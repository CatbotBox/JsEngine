import type {FileSource, Platform, PlatformInput, PlatformScreen} from "./platform";

export interface TerminalSubscription {
    dispose(): void;
}

/**
 * What the engine needs from a browser terminal. An xterm.js `Terminal` satisfies it as is; the
 * page owns sizing (the fit addon) and reports changes through `onResize`.
 */
export interface BrowserTerminal {
    readonly cols: number;
    readonly rows: number;
    write(data: string): void;
    /** Raw terminal bytes typed by the user, escape sequences included. */
    onData(listener: (data: string) => void): TerminalSubscription;
    onResize(listener: (size: {cols: number, rows: number}) => void): TerminalSubscription;
}

/** The page globals used, listed rather than taken from the DOM typings so the src build needs no `dom` lib. */
interface BrowserHost {
    readonly navigator?: {readonly hardwareConcurrency?: number};
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
}

const EXIT_EVENTS = ["pagehide", "beforeunload"] as const;

/** A page with a terminal: output, input and size from `terminal`, files from what the page preloaded. No workers. */
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
        inflate: () => {
            throw new Error("PNG inflate is not available in the browser until Increment 3.2; use PPM or JPEG textures");
        },
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

/** Both events can fire for one unload; the callback runs once. */
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
