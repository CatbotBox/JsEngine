import {describe, expect, test} from "../../engine/testing/harness";
import {browserPlatform, worldTerminal} from "./browserPlatform";
import type {BrowserTerminal, TerminalSubscription} from "./browserPlatform";
import {MemoryFileSource} from "../../engine/testing/memoryPlatform";
import {inflate} from "../../engine/assets/image/inflate";

class FakeTerminal implements BrowserTerminal {
    public cols = 80;
    public rows = 24;
    public readonly written: string[] = [];
    public readonly resizeListeners = new Set<(size: {cols: number, rows: number}) => void>();

    public write(data: string): void {
        this.written.push(data);
    }

    public onResize(listener: (size: {cols: number, rows: number}) => void): TerminalSubscription {
        this.resizeListeners.add(listener);
        return {dispose: () => this.resizeListeners.delete(listener)};
    }

    public resize(cols: number, rows: number): void {
        this.cols = cols;
        this.rows = rows;
        for (const listener of [...this.resizeListeners]) listener({cols, rows});
    }
}

type Listeners = Map<string, Set<() => void>>;

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

describe("worldTerminal", () => {
    test("writes go to the terminal and size follows it; it is only a surface, input comes from the DOM adapter", () => {
        const terminal = new FakeTerminal();
        const world = worldTerminal(terminal);
        world.write("frame");
        expect(terminal.written).toEqual(["frame"]);
        expect(world.size()).toEqual({columns: 80, rows: 24});
        expect(world.backlogged).toBeUndefined();
        expect(Object.keys(world).sort()).toEqual(["onResize", "size", "write"]);

        let resizes = 0;
        const stop = world.onResize(() => resizes++);
        terminal.resize(100, 30);
        expect(resizes).toBe(1);
        expect(world.size()).toEqual({columns: 100, rows: 30});
        stop();
        terminal.resize(90, 20);
        expect(resizes).toBe(1);
        expect(terminal.resizeListeners.size).toBe(0);
    });
});

describe("browserPlatform", () => {
    test("files are the page's, there are no workers and inflate is the hand-written one", () => {
        const files = new MemoryFileSource({"a.txt": "x"});
        const platform = browserPlatform(files);
        expect(platform.files).toBe(files);
        expect(platform.workers).toBeUndefined();
        expect(platform.requestedRasterWorkers).toBeUndefined();
        expect(platform.inflate).toBe(inflate);
        expect(platform.hardwareConcurrency()).toBeGreaterThan(0);
        expect(platform.now()).toBeGreaterThan(-1);
    });

    test("onExit runs once on pagehide or beforeunload, and cancels", () => {
        const platform = browserPlatform(new MemoryFileSource());
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
