import {describe, expect, test} from "../testing/harness";
import {browserPlatform} from "./browserPlatform";
import type {BrowserTerminal, TerminalSubscription} from "./browserPlatform";
import {MemoryFileSource} from "./memoryPlatform";
import {ConsoleInput} from "../input/consoleInput";
import type {KeyEvent} from "../input/consoleInput";
import {Key} from "../input/key";
import {inflate} from "../rendering/3d/image/inflate";

class FakeTerminal implements BrowserTerminal {
    public cols = 80;
    public rows = 24;
    public readonly written: string[] = [];
    public readonly dataListeners = new Set<(data: string) => void>();
    public readonly resizeListeners = new Set<(size: {cols: number, rows: number}) => void>();

    public write(data: string): void {
        this.written.push(data);
    }

    public onData(listener: (data: string) => void): TerminalSubscription {
        this.dataListeners.add(listener);
        return {dispose: () => this.dataListeners.delete(listener)};
    }

    public onResize(listener: (size: {cols: number, rows: number}) => void): TerminalSubscription {
        this.resizeListeners.add(listener);
        return {dispose: () => this.resizeListeners.delete(listener)};
    }

    public type(data: string): void {
        for (const listener of [...this.dataListeners]) listener(data);
    }

    public resize(cols: number, rows: number): void {
        this.cols = cols;
        this.rows = rows;
        for (const listener of [...this.resizeListeners]) listener({cols, rows});
    }
}

type Listeners = Map<string, Set<() => void>>;

/** Gives globalThis add/removeEventListener for the duration of `body`, recording listeners per event. */
function withPageEvents(body: (listeners: Listeners) => void): void {
    const host = globalThis as {addEventListener?: unknown, removeEventListener?: unknown};
    const saved = {add: host.addEventListener, remove: host.removeEventListener};
    const listeners: Listeners = new Map();
    host.addEventListener = (type: string, listener: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
    };
    host.removeEventListener = (type: string, listener: () => void) => listeners.get(type)?.delete(listener);
    try {
        body(listeners);
    } finally {
        host.addEventListener = saved.add;
        host.removeEventListener = saved.remove;
    }
}

function fire(listeners: Listeners, type: string): void {
    for (const listener of [...(listeners.get(type) ?? [])]) listener();
}

describe("browserPlatform", () => {
    test("output writes to the terminal and size follows it", () => {
        const terminal = new FakeTerminal();
        const platform = browserPlatform(terminal, new MemoryFileSource());
        platform.output.write("frame");
        expect(terminal.written).toEqual(["frame"]);
        expect(platform.screen.size()).toEqual({columns: 80, rows: 24});

        let resizes = 0;
        const stop = platform.screen.onResize(() => resizes++);
        terminal.resize(100, 30);
        expect(resizes).toBe(1);
        expect(platform.screen.size()).toEqual({columns: 100, rows: 30});
        stop();
        terminal.resize(90, 20);
        expect(resizes).toBe(1);
        expect(terminal.resizeListeners.size).toBe(0);
    });

    test("terminal bytes reach the console input's key decoder", () => {
        const terminal = new FakeTerminal();
        const platform = browserPlatform(terminal, new MemoryFileSource());
        const input = new ConsoleInput();
        const keys: KeyEvent[] = [];
        input.onKeyDown.add(key => keys.push(key));
        withPageEvents(() => {
            input.enable({platform});
            expect(terminal.written.join("").includes("\x1b[?1003h")).toBe(true);
            terminal.type("\x1b[A");
            terminal.type("\x03");
            expect(keys.map(key => key.id)).toEqual([Key.Up, "c"]);
            expect(keys[1].ctrl).toBe(true);
            input.disable();
        });
        expect(terminal.dataListeners.size).toBe(0);
    });

    test("files are the page's, there are no workers and inflate is the hand-written one", () => {
        const files = new MemoryFileSource({"a.txt": "x"});
        const platform = browserPlatform(new FakeTerminal(), files);
        expect(platform.files).toBe(files);
        expect(platform.workers).toBeUndefined();
        expect(platform.requestedRasterWorkers).toBeUndefined();
        expect(platform.inflate).toBe(inflate);
        expect(platform.hardwareConcurrency()).toBeGreaterThan(0);
        expect(platform.now()).toBeGreaterThan(-1);
    });

    test("onExit runs once on pagehide or beforeunload, and cancels", () => {
        const platform = browserPlatform(new FakeTerminal(), new MemoryFileSource());
        withPageEvents(listeners => {
            let exits = 0;
            platform.onExit(() => exits++);
            fire(listeners, "pagehide");
            fire(listeners, "beforeunload");
            expect(exits).toBe(1);

            const cancel = platform.onExit(() => exits++);
            cancel();
            fire(listeners, "beforeunload");
            expect(exits).toBe(1);
            expect(listeners.get("pagehide")!.size + listeners.get("beforeunload")!.size).toBe(0);
        });
    });
});
