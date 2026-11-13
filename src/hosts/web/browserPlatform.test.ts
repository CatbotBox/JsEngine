import {describe, expect, test} from "../../engine/testing/harness";
import {browserPlatform} from "./browserPlatform";
import {MemoryFileSource} from "../../engine/testing/memoryPlatform";
import {inflate} from "../../engine/assets/image/inflate";

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
