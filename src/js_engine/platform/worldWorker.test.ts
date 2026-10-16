import {describe, expect, test} from "../testing/harness";
import {browserWorkerFactory, browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorker, BrowserWorkerHost} from "./browserWorkers";
import {PageConnection} from "./worldWorkerPlatform";
import type {WorldWorkerScope} from "./worldWorkerPlatform";
import {connectWorldWorker} from "./worldWorkerPage";
import type {PageTerminal, WorldWorker} from "./worldWorkerPage";
import type {TerminalSubscription} from "./browserPlatform";
import {isPageToWorldMessage, isWorldToPageMessage, requestedRasterWorkersFromQuery} from "./worldWorkerProtocol";
import type {PageToWorldMessage, WorldToPageMessage} from "./worldWorkerProtocol";
import {MemoryFileSource, MemoryOutput, MemoryPlatform} from "./memoryPlatform";
import {WORKER_ENTRY_POINT} from "./platform";
import type {PlatformOutput} from "./platform";
import {nodePlatform} from "./nodePlatform";
import {inflate} from "../rendering/3d/image/inflate";
import {World} from "../core/world";
import {RootSystemGroup} from "../core/rootSystemGroup";
import {System} from "../core/system";
import {Camera} from "../rendering/camera";
import {ConsoleRenderPassSystemGroup} from "../rendering/console/consoleRenderPassSystemGroup";

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

/** The world worker's `self`: records what the world posts, and delivers what the page sends. */
class FakeScope implements WorldWorkerScope {
    public readonly posted: WorldToPageMessage[] = [];
    public readonly navigator = {hardwareConcurrency: 6};
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public constructor(host: BrowserWorkerHost = {}) {
        Object.assign(this, host);
    }

    public postMessage(message: WorldToPageMessage): void {
        this.posted.push(message);
    }

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.push(listener);
    }

    public send(message: PageToWorldMessage): void {
        for (const listener of [...this.listeners]) listener({data: message});
    }
}

const INIT: PageToWorldMessage = {type: "init", columns: 100, rows: 30, requestedRasterWorkers: 2};

async function openConnection(scope: FakeScope = new FakeScope(), files = new MemoryFileSource()): Promise<PageConnection> {
    const opening = PageConnection.open(scope, files);
    scope.send(INIT);
    return await opening;
}

/** A Web Worker that records what it is sent and lets the test fire its events. */
class FakeBrowserWorker implements BrowserWorker {
    public static readonly created: FakeBrowserWorker[] = [];
    /** Each call's arguments, so a missing transfer list is told apart from an undefined one. */
    public readonly posted: unknown[][] = [];
    public terminated = false;
    private readonly listeners = new Map<string, ((event: never) => void)[]>();

    public constructor(public readonly url: string) {
        FakeBrowserWorker.created.push(this);
    }

    public postMessage(...args: unknown[]): void {
        this.posted.push(args);
    }

    public addEventListener(type: string, listener: (event: never) => void): void {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type)!.push(listener);
    }

    public terminate(): void {
        this.terminated = true;
    }

    public fire(type: string, event: object): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event as never);
    }
}

class FakeBlob {
    public constructor(public readonly parts: readonly string[], public readonly options: {readonly type: string}) {
    }
}

function fakeBrowserHost(extra: BrowserWorkerHost = {}): BrowserWorkerHost & {readonly blobs: FakeBlob[]} {
    const blobs: FakeBlob[] = [];
    return {
        Worker: FakeBrowserWorker,
        Blob: FakeBlob,
        URL: {
            createObjectURL(blob: unknown): string {
                blobs.push(blob as FakeBlob);
                return `blob:${blobs.length}`;
            },
        },
        blobs,
        ...extra,
    };
}

class FakePageTerminal implements PageTerminal {
    public cols = 120;
    public rows = 40;
    public readonly written: string[] = [];
    /** Write callbacks not yet run: the terminal has not parsed those writes. */
    public readonly unparsed: (() => void)[] = [];
    public readonly dataListeners = new Set<(data: string) => void>();
    public readonly resizeListeners = new Set<(size: {cols: number, rows: number}) => void>();

    public write(data: string, callback?: () => void): void {
        this.written.push(data);
        if (callback !== undefined) this.unparsed.push(callback);
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

    public parseAll(): void {
        for (const callback of this.unparsed.splice(0)) callback();
    }
}

class FakeWorldWorker implements WorldWorker {
    public readonly posted: PageToWorldMessage[] = [];
    public terminated = false;
    private readonly listeners = new Map<string, ((event: never) => void)[]>();

    public postMessage(message: PageToWorldMessage): void {
        this.posted.push(message);
    }

    public addEventListener(type: "message" | "error", listener: (event: never) => void): void {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type)!.push(listener);
    }

    public terminate(): void {
        this.terminated = true;
    }

    public emit(message: WorldToPageMessage): void {
        for (const listener of this.listeners.get("message") ?? []) listener({data: message} as never);
    }

    public crash(message: string): void {
        for (const listener of this.listeners.get("error") ?? []) listener({message} as never);
    }
}

describe("world worker protocol", () => {
    test("?threads= is a whole number of raster workers, anything else is no request", () => {
        expect(requestedRasterWorkersFromQuery("?threads=4")).toBe(4);
        expect(requestedRasterWorkersFromQuery("?threads=0")).toBe(0);
        expect(requestedRasterWorkersFromQuery("?a=1&threads=3")).toBe(3);
        expect(requestedRasterWorkersFromQuery("")).toBeUndefined();
        expect(requestedRasterWorkersFromQuery("?threads=")).toBeUndefined();
        expect(requestedRasterWorkersFromQuery("?threads=-1")).toBeUndefined();
        expect(requestedRasterWorkersFromQuery("?threads=2.5")).toBeUndefined();
        expect(requestedRasterWorkersFromQuery("?threads=many")).toBeUndefined();
    });

    test("each side only accepts the other side's message types", () => {
        expect(isPageToWorldMessage({type: "init", columns: 1, rows: 1})).toBe(true);
        expect(isPageToWorldMessage({type: "output", data: ""})).toBe(false);
        expect(isWorldToPageMessage({type: "output", data: ""})).toBe(true);
        expect(isWorldToPageMessage({type: "input", data: ""})).toBe(false);
        expect(isWorldToPageMessage(null)).toBe(false);
        expect(isWorldToPageMessage("output")).toBe(false);
    });
});

describe("PageConnection (the world worker's platform)", () => {
    test("opens on init: the size, thread request, cores, files and inflate", async () => {
        const scope = new FakeScope();
        const files = new MemoryFileSource();
        let opened = false;
        const opening = PageConnection.open(scope, files).then(connection => {
            opened = true;
            return connection;
        });
        scope.send({type: "input", data: "x"});
        await nextTask();
        expect(opened).toBe(false);

        scope.send(INIT);
        const {platform} = await opening;
        expect(platform.screen.size()).toEqual({columns: 100, rows: 30});
        expect(platform.requestedRasterWorkers!()).toBe(2);
        expect(platform.hardwareConcurrency()).toBe(6);
        expect(platform.files).toBe(files);
        expect(platform.inflate).toBe(inflate);
        expect(platform.input.available()).toBe(true);
        expect(platform.now()).toBeGreaterThan(-1);
    });

    test("input reaches the reader only while it reads", async () => {
        const scope = new FakeScope();
        const {platform} = await openConnection(scope);
        const received: string[] = [];
        scope.send({type: "input", data: "early"});
        platform.input.start(data => received.push(data));
        scope.send({type: "input", data: "\x1b[A"});
        platform.input.stop();
        scope.send({type: "input", data: "late"});
        expect(received).toEqual(["\x1b[A"]);
    });

    test("resize messages change the size and notify subscribers until they unsubscribe", async () => {
        const scope = new FakeScope();
        const {platform} = await openConnection(scope);
        let resizes = 0;
        const stop = platform.screen.onResize(() => resizes++);
        scope.send({type: "resize", columns: 80, rows: 20});
        expect(platform.screen.size()).toEqual({columns: 80, rows: 20});
        expect(resizes).toBe(1);
        stop();
        scope.send({type: "resize", columns: 90, rows: 25});
        expect(resizes).toBe(1);
        expect(platform.screen.size()).toEqual({columns: 90, rows: 25});
    });

    test("pagehide runs each exit callback once; a cancelled one never", async () => {
        const scope = new FakeScope();
        const {platform} = await openConnection(scope);
        let exits = 0;
        platform.onExit(() => exits++);
        const cancel = platform.onExit(() => exits += 10);
        cancel();
        scope.send({type: "exit"});
        scope.send({type: "exit"});
        expect(exits).toBe(1);
    });

    test("every write of one task goes out as one output message when the task ends", async () => {
        const scope = new FakeScope();
        const {platform} = await openConnection(scope);
        platform.output.write("\x1b[H");
        platform.output.write("");
        platform.output.write("row 1");
        platform.output.write("row 2");
        expect(scope.posted).toEqual([]);
        await nextTask();
        expect(scope.posted).toEqual([{type: "output", data: "\x1b[Hrow 1row 2"}]);

        platform.output.write("next frame");
        await nextTask();
        expect(scope.posted.length).toBe(2);
        expect(scope.posted[1]).toEqual({type: "output", data: "next frame"});
        await nextTask();
        expect(scope.posted.length).toBe(2);
    });

    test("quit and fail are posted after everything written before them", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        connection.platform.output.write("last frame");
        connection.quit();
        expect(scope.posted).toEqual([{type: "output", data: "last frame"}, {type: "quit"}]);
        connection.fail(new Error("boom"));
        connection.fail("plain");
        await nextTask();
        expect(scope.posted.slice(2)).toEqual([{type: "error", message: "boom"}, {type: "error", message: "plain"}]);
    });

    test("output is backlogged while two messages wait for the page to parse them", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        const output = connection.platform.output;
        expect(output.backlogged!()).toBe(false);
        output.write("a");
        connection.flush();
        expect(output.backlogged!()).toBe(false);
        output.write("b");
        connection.flush();
        expect(output.backlogged!()).toBe(true);
        scope.send({type: "written"});
        expect(output.backlogged!()).toBe(false);
        scope.send({type: "written"});
        scope.send({type: "written"});
        output.write("c");
        connection.flush();
        output.write("d");
        connection.flush();
        expect(output.backlogged!()).toBe(true);
    });

    test("raster workers are the browser factory only in a cross-origin isolated worker", async () => {
        const plain = await openConnection(new FakeScope(fakeBrowserHost()));
        expect(plain.platform.workers).toBeUndefined();
        const isolated = await openConnection(new FakeScope(fakeBrowserHost({crossOriginIsolated: true, SharedArrayBuffer})));
        expect(isolated.platform.workers).toBeDefined();
        const noNestedWorkers = await openConnection(new FakeScope(fakeBrowserHost({crossOriginIsolated: true, SharedArrayBuffer, Worker: undefined})));
        expect(noNestedWorkers.platform.workers).toBeUndefined();
    });
});

describe("browserWorkerFactory", () => {
    test("spawns from one blob URL per script and posts the spawn data first", () => {
        FakeBrowserWorker.created.length = 0;
        const host = fakeBrowserHost();
        const factory = browserWorkerFactory(host);
        const data = {bandIndex: 1};
        factory.spawn("function workerMain() {}", data);
        factory.spawn("function workerMain() {}", {bandIndex: 2});
        factory.spawn("function workerMain(other) {}", {});

        expect(host.blobs.length).toBe(2);
        const [first, second, third] = FakeBrowserWorker.created;
        expect(first.url).toBe("blob:1");
        expect(second.url).toBe("blob:1");
        expect(third.url).toBe("blob:2");
        const script = host.blobs[0].parts.join("");
        expect(script.startsWith("function workerMain() {}")).toBe(true);
        expect(script.includes(`${WORKER_ENTRY_POINT}(first.data`)).toBe(true);
        expect(host.blobs[0].options.type).toBe("text/javascript");
        expect(first.posted).toEqual([[data]]);
    });

    test("the handle forwards messages, errors and terminate, and has no unref", () => {
        FakeBrowserWorker.created.length = 0;
        const handle = browserWorkerFactory(fakeBrowserHost()).spawn("", {});
        const worker = FakeBrowserWorker.created[0];
        const buffer = new ArrayBuffer(4);
        handle.postMessage("plain");
        handle.postMessage("moved", [buffer]);
        expect(worker.posted.slice(1)).toEqual([["plain"], ["moved", [buffer]]]);

        const messages: unknown[] = [];
        const errors: unknown[] = [];
        handle.onMessage(message => messages.push(message));
        handle.onError(error => errors.push(error));
        worker.fire("message", {data: 7});
        const thrown = new Error("x");
        worker.fire("error", {error: thrown, message: "x"});
        worker.fire("error", {message: "only a message"});
        expect(messages).toEqual([7]);
        expect(errors).toEqual([thrown, "only a message"]);

        expect(handle.unref).toBeUndefined();
        handle.terminate();
        expect(worker.terminated).toBe(true);
    });

    test("a host without Worker, Blob or URL cannot be a factory", () => {
        expect(() => browserWorkerFactory({...fakeBrowserHost(), Worker: undefined})).toThrow("cannot spawn");
        expect(() => browserWorkerFactory({...fakeBrowserHost(), Blob: undefined})).toThrow("cannot spawn");
        expect(browserWorkersIfIsolated(fakeBrowserHost({crossOriginIsolated: false, SharedArrayBuffer}))).toBeUndefined();
        expect(browserWorkersIfIsolated(fakeBrowserHost({crossOriginIsolated: true}))).toBeUndefined();
        expect(browserWorkersIfIsolated(fakeBrowserHost({crossOriginIsolated: true, SharedArrayBuffer}))).toBeDefined();
    });

    if (typeof (globalThis as {Worker?: unknown}).Worker === "function") {
        test("a real Web Worker gets the spawn data first and later messages through its port", async () => {
            const source = `function ${WORKER_ENTRY_POINT}(data, port) {
                port.postMessage({first: data.greeting});
                port.onMessage(message => port.postMessage({echo: message}));
            }`;
            const handle = browserWorkerFactory().spawn(source, {greeting: "hello"});
            const received: unknown[] = [];
            const done = new Promise<void>(resolve => handle.onMessage(message => {
                received.push(message);
                if (received.length === 2) resolve();
            }));
            handle.postMessage("again");
            await done;
            handle.terminate();
            expect(received).toEqual([{first: "hello"}, {echo: "again"}]);
        });
    }
});

describe("connectWorldWorker (the page's end)", () => {
    test("sends init with the terminal's size first, then forwards typed bytes, resizes and pagehide", () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(terminal, worker, {name: "the 3D demo", requestedRasterWorkers: 3});
        terminal.type("\x1b[A");
        terminal.resize(90, 20);
        page.exit();
        expect(worker.posted).toEqual([
            {type: "init", columns: 120, rows: 40, requestedRasterWorkers: 3},
            {type: "input", data: "\x1b[A"},
            {type: "resize", columns: 90, rows: 20},
            {type: "exit"},
        ]);
    });

    test("writes each output message and acknowledges it once the terminal has parsed it", () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        connectWorldWorker(terminal, worker, {name: "the demo"});
        worker.emit({type: "output", data: "frame 1"});
        worker.emit({type: "output", data: "frame 2"});
        expect(terminal.written).toEqual(["frame 1", "frame 2"]);
        expect(worker.posted.filter(message => message.type === "written").length).toBe(0);
        terminal.parseAll();
        expect(worker.posted.filter(message => message.type === "written").length).toBe(2);
    });

    test("quit: says it stopped, stops forwarding and terminates the worker", () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(terminal, worker, {name: "the demo"});
        worker.emit({type: "output", data: "last frame"});
        worker.emit({type: "quit"});
        expect(worker.terminated).toBe(true);
        expect(terminal.written[1].includes("Stopped. Reload the page to restart.")).toBe(true);
        expect(terminal.dataListeners.size + terminal.resizeListeners.size).toBe(0);

        const sent = worker.posted.length;
        terminal.parseAll();
        page.exit();
        worker.emit({type: "output", data: "after quit"});
        expect(worker.posted.length).toBe(sent);
        expect(terminal.written.length).toBe(2);
    });

    test("a startup failure is shown in red and ends the worker; an uncaught error is shown", () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        connectWorldWorker(terminal, worker, {name: "the 3D demo"});
        worker.crash("kaboom");
        expect(terminal.written[0].includes("\x1b[31mError in the 3D demo: kaboom")).toBe(true);
        expect(worker.terminated).toBe(false);
        worker.emit({type: "error", message: "manifest missing"});
        expect(terminal.written[1].includes("\x1b[31mCould not start the 3D demo: manifest missing")).toBe(true);
        expect(worker.terminated).toBe(true);
    });
});

class FrameProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

describe("ConsoleRenderPassSystemGroup on a backlogged host", () => {
    test("skips whole frames while the host is backlogged, then repaints everything", () => {
        const platform = new MemoryPlatform({columns: 40, rows: 10});
        let backlogged = false;
        (platform.output as MemoryOutput & {backlogged?: () => boolean}).backlogged = () => backlogged;
        const world = new World({platform});
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(ConsoleRenderPassSystemGroup);
        const probe = world.getOrCreateSystem(FrameProbeSystem);
        try {
            root.update();
            root.update();
            platform.output.clear();
            const framesBefore = probe.frames;
            root.update();
            expect(platform.output.text()).toBe("");
            expect(probe.frames).toBe(framesBefore + 1);

            backlogged = true;
            root.update();
            root.update();
            expect(platform.output.text()).toBe("");
            expect(probe.frames).toBe(framesBefore + 1);

            backlogged = false;
            root.update();
            expect(probe.frames).toBe(framesBefore + 2);
            expect(platform.output.text().startsWith("\x1b[H")).toBe(true);
            expect(platform.output.text().split("\r\n").length).toBe(10);
        } finally {
            group.enabled = false;
        }
    });

    test("the memory and node hosts never report a backlog, so they never skip a frame", () => {
        const outputs: PlatformOutput[] = [new MemoryPlatform().output, nodePlatform().output];
        for (const output of outputs) expect(output.backlogged).toBeUndefined();
    });
});
