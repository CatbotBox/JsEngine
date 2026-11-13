import {describe, expect, test} from "../../engine/testing/harness";
import {browserWorkerFactory, browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorker, BrowserWorkerHost} from "./browserWorkers";
import {PageConnection} from "./worldWorkerPlatform";
import type {WorldWorkerScope} from "./worldWorkerPlatform";
import {connectWorldWorker} from "./worldWorkerPage";
import type {PageTerminal, WorldWorker} from "./worldWorkerPage";
import type {TerminalSubscription} from "./browserPlatform";
import {
    FIXED_TERMINAL_LIMITS,
    fixedTerminalSizeFromQuery,
    isPageToWorldMessage,
    isWorldToPageMessage,
    requestedRasterWorkersFromQuery,
} from "./worldWorkerProtocol";
import type {PageToWorldMessage, WorldToPageMessage} from "./worldWorkerProtocol";
import {MemoryFileSource, MemoryPlatform, MemoryTerminal} from "../../engine/testing/memoryPlatform";
import {WORKER_ENTRY_POINT} from "../../engine/platform/platform";
import type {CellSurface} from "../../backends/cells/cellSurface";
import {CellSurfaceResource} from "../../backends/cells/cellSurfaceResource";
import {inflate} from "../../engine/assets/image/inflate";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import {Camera} from "../../engine/rendering/camera";
import {CellRenderSystemGroup} from "../../backends/cells/cellRenderSystemGroup";
import {Input} from "../../engine/input/input";
import {Key} from "../../engine/input/key";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import type {InputEvent} from "../../engine/input/inputEvent";

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

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
const UP_PRESSED: InputEvent = {type: "keyDown", key: Key.Up, repeat: false, ...NO_MODIFIERS};
const UP_RELEASED: InputEvent = {type: "keyUp", key: Key.Up, ...NO_MODIFIERS};
const TYPED_X: InputEvent = {type: "text", text: "x"};

async function openConnection(scope: FakeScope = new FakeScope(), files = new MemoryFileSource()): Promise<PageConnection> {
    const opening = PageConnection.open(scope, files);
    scope.send(INIT);
    return await opening;
}

class FakeBrowserWorker implements BrowserWorker {
    public static readonly created: FakeBrowserWorker[] = [];
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
    public readonly unparsed: (() => void)[] = [];
    public readonly resizeListeners = new Set<(size: {cols: number, rows: number}) => void>();

    public write(data: string, callback?: () => void): void {
        this.written.push(data);
        if (callback !== undefined) this.unparsed.push(callback);
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

    test("?cols= and ?rows= fix each dimension given as a whole number in range; others fit the window", () => {
        expect(fixedTerminalSizeFromQuery("?cols=120&rows=40")).toEqual({columns: 120, rows: 40});
        expect(fixedTerminalSizeFromQuery("?threads=2&rows=30")).toEqual({rows: 30});
        expect(fixedTerminalSizeFromQuery("?cols=100")).toEqual({columns: 100});
        expect(fixedTerminalSizeFromQuery("")).toEqual({});
        expect(fixedTerminalSizeFromQuery("?cols=&rows=")).toEqual({});
        expect(fixedTerminalSizeFromQuery("?cols=80.5&rows=-3")).toEqual({});
        expect(fixedTerminalSizeFromQuery("?cols=wide&rows=1e2")).toEqual({});
        const {minColumns, minRows, max} = FIXED_TERMINAL_LIMITS;
        expect(fixedTerminalSizeFromQuery(`?cols=${minColumns}&rows=${minRows}`)).toEqual({columns: minColumns, rows: minRows});
        expect(fixedTerminalSizeFromQuery(`?cols=${minColumns - 1}&rows=${minRows - 1}`)).toEqual({});
        expect(fixedTerminalSizeFromQuery(`?cols=${max}&rows=${max + 1}`)).toEqual({columns: max});
    });

    test("each side only accepts the other side's message types", () => {
        expect(isPageToWorldMessage({type: "init", columns: 1, rows: 1})).toBe(true);
        expect(isPageToWorldMessage({type: "output", data: ""})).toBe(false);
        expect(isWorldToPageMessage({type: "output", data: ""})).toBe(true);
        expect(isWorldToPageMessage({type: "inputEvents", events: []})).toBe(false);
        expect(isWorldToPageMessage(null)).toBe(false);
        expect(isWorldToPageMessage("output")).toBe(false);
    });

    test("input arrives as engine input events, each one validated; raw terminal bytes are gone", () => {
        expect(isPageToWorldMessage({type: "inputEvents", events: [UP_PRESSED, TYPED_X, UP_RELEASED]})).toBe(true);
        expect(isPageToWorldMessage({type: "inputEvents", events: []})).toBe(true);
        expect(isPageToWorldMessage({type: "inputEvents", events: [UP_PRESSED, {type: "keyDown", key: "up"}]})).toBe(false);
        expect(isPageToWorldMessage({type: "inputEvents", events: [{...UP_PRESSED, key: "hyper"}]})).toBe(false);
        expect(isPageToWorldMessage({type: "inputEvents", events: "keyDown"})).toBe(false);
        expect(isPageToWorldMessage({type: "inputEvents"})).toBe(false);
        expect(isPageToWorldMessage({type: "input", data: "\x1b[A"})).toBe(false);
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
        scope.send({type: "inputEvents", events: [TYPED_X]});
        await nextTask();
        expect(opened).toBe(false);

        scope.send(INIT);
        const {platform, terminal} = await opening;
        expect(terminal.size()).toEqual({columns: 100, rows: 30});
        expect(platform.requestedRasterWorkers!()).toBe(2);
        expect(platform.hardwareConcurrency()).toBe(6);
        expect(platform.files).toBe(files);
        expect(platform.inflate).toBe(inflate);
        expect(Object.keys(terminal).sort()).toEqual(["backlogged", "onResize", "size", "write"]);
        expect(platform.now()).toBeGreaterThan(-1);
    });

    test("input events reach the connected Input only while it is connected, in order", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        const input = new Input();
        scope.send({type: "inputEvents", events: [TYPED_X]});
        const disconnect = connection.connectInput(input);
        scope.send({type: "inputEvents", events: [UP_PRESSED, TYPED_X]});
        scope.send({type: "inputEvents", events: [UP_RELEASED, {type: "pointerMove", x: Number.NaN}]} as unknown as PageToWorldMessage);
        disconnect();
        scope.send({type: "inputEvents", events: [UP_RELEASED]});
        input.beginFrame();
        expect(input.events).toEqual([UP_PRESSED, TYPED_X]);
        expect(input.keyHeld(Key.Up)).toBe(true);
    });

    test("resize messages change the size and notify subscribers until they unsubscribe", async () => {
        const scope = new FakeScope();
        const {terminal} = await openConnection(scope);
        let resizes = 0;
        const stop = terminal.onResize(() => resizes++);
        scope.send({type: "resize", columns: 80, rows: 20});
        expect(terminal.size()).toEqual({columns: 80, rows: 20});
        expect(resizes).toBe(1);
        stop();
        scope.send({type: "resize", columns: 90, rows: 25});
        expect(resizes).toBe(1);
        expect(terminal.size()).toEqual({columns: 90, rows: 25});
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
        const {terminal} = await openConnection(scope);
        terminal.write("\x1b[H");
        terminal.write("");
        terminal.write("row 1");
        terminal.write("row 2");
        expect(scope.posted).toEqual([]);
        await nextTask();
        expect(scope.posted).toEqual([{type: "output", data: "\x1b[Hrow 1row 2"}]);

        terminal.write("next frame");
        await nextTask();
        expect(scope.posted.length).toBe(2);
        expect(scope.posted[1]).toEqual({type: "output", data: "next frame"});
        await nextTask();
        expect(scope.posted.length).toBe(2);
    });

    test("quit and fail are posted after everything written before them", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        connection.terminal.write("last frame");
        connection.quit();
        expect(scope.posted).toEqual([{type: "output", data: "last frame"}, {type: "quit"}]);
        connection.fail(new Error("boom"));
        connection.fail("plain");
        await nextTask();
        expect(scope.posted.slice(2)).toEqual([{type: "error", message: "boom"}, {type: "error", message: "plain"}]);
    });

    test("the terminal is backlogged while two messages wait for the page to parse them", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        const terminal = connection.terminal;
        expect(terminal.backlogged!()).toBe(false);
        terminal.write("a");
        connection.flush();
        expect(terminal.backlogged!()).toBe(false);
        terminal.write("b");
        connection.flush();
        expect(terminal.backlogged!()).toBe(true);
        scope.send({type: "written"});
        expect(terminal.backlogged!()).toBe(false);
        scope.send({type: "written"});
        scope.send({type: "written"});
        terminal.write("c");
        connection.flush();
        terminal.write("d");
        connection.flush();
        expect(terminal.backlogged!()).toBe(true);
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
    test("sends init with the terminal's size first, then input events, resizes and pagehide", async () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(terminal, worker, {name: "the 3D demo", requestedRasterWorkers: 3});
        page.input.enqueue(UP_PRESSED);
        await nextTask();
        terminal.resize(90, 20);
        page.exit();
        expect(worker.posted).toEqual([
            {type: "init", columns: 120, rows: 40, requestedRasterWorkers: 3},
            {type: "inputEvents", events: [UP_PRESSED]},
            {type: "resize", columns: 90, rows: 20},
            {type: "exit"},
        ]);
    });

    test("input events of one task go out as one message when the task ends", async () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(terminal, worker, {name: "the demo"});
        page.input.enqueue(UP_PRESSED);
        page.input.enqueue(TYPED_X);
        expect(worker.posted.length).toBe(1);
        await nextTask();
        page.input.enqueue(UP_RELEASED);
        await nextTask();
        expect(worker.posted.slice(1)).toEqual([
            {type: "inputEvents", events: [UP_PRESSED, TYPED_X]},
            {type: "inputEvents", events: [UP_RELEASED]},
        ]);
        await nextTask();
        expect(worker.posted.length).toBe(3);
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

    test("quit: says it stopped, stops forwarding and terminates the worker", async () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(terminal, worker, {name: "the demo"});
        worker.emit({type: "output", data: "last frame"});
        worker.emit({type: "quit"});
        expect(worker.terminated).toBe(true);
        expect(terminal.written[1].includes("Stopped. Reload the page to restart.")).toBe(true);
        expect(terminal.resizeListeners.size).toBe(0);

        const sent = worker.posted.length;
        terminal.parseAll();
        page.exit();
        page.input.enqueue(UP_PRESSED);
        await nextTask();
        worker.emit({type: "output", data: "after quit"});
        expect(worker.posted.length).toBe(sent);
        expect(terminal.written.length).toBe(2);
    });

    test("quit runs onQuit once, after the stopped line; an error does not", () => {
        const terminal = new FakePageTerminal();
        const worker = new FakeWorldWorker();
        const writtenAtQuit: number[] = [];
        connectWorldWorker(terminal, worker, {name: "the demo", onQuit: () => writtenAtQuit.push(terminal.written.length)});
        worker.emit({type: "quit"});
        worker.emit({type: "quit"});
        expect(writtenAtQuit).toEqual([1]);

        const failing = new FakeWorldWorker();
        let quits = 0;
        connectWorldWorker(new FakePageTerminal(), failing, {name: "the demo", onQuit: () => quits++});
        failing.emit({type: "error", message: "kaboom"});
        expect(quits).toBe(0);
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
        return CellRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

describe("CellRenderSystemGroup on a backlogged host", () => {
    test("skips whole frames while the host is backlogged, then repaints everything", () => {
        const terminal = new MemoryTerminal({columns: 40, rows: 10});
        let backlogged = false;
        (terminal as MemoryTerminal & {backlogged?: () => boolean}).backlogged = () => backlogged;
        const world = new World({platform: new MemoryPlatform()});
        world.resources.insert(new CellSurfaceResource(terminal));
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(FrameProbeSystem);
        try {
            root.update();
            root.update();
            terminal.clear();
            const framesBefore = probe.frames;
            root.update();
            expect(terminal.text()).toBe("");
            expect(probe.frames).toBe(framesBefore + 1);

            backlogged = true;
            root.update();
            root.update();
            expect(terminal.text()).toBe("");
            expect(probe.frames).toBe(framesBefore + 1);

            backlogged = false;
            root.update();
            expect(probe.frames).toBe(framesBefore + 2);
            expect(terminal.text().startsWith("\x1b[H")).toBe(true);
            expect(terminal.text().split("\r\n").length).toBe(10);
        } finally {
            group.enabled = false;
        }
    });

    test("the memory terminal never reports a backlog, so it never skips a frame", () => {
        const surface: CellSurface = new MemoryTerminal();
        expect(surface.backlogged).toBeUndefined();
    });
});
