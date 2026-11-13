import {describe, expect, test} from "../../engine/testing/harness";
import {browserWorkerFactory, browserWorkersIfIsolated} from "./browserWorkers";
import type {BrowserWorker, BrowserWorkerHost} from "./browserWorkers";
import {PageConnection} from "./worldWorkerPlatform";
import type {WorldWorkerScope} from "./worldWorkerPlatform";
import {connectWorldWorker, STOPPED_STATUS, startingStatus, surfaceMismatchMessage} from "./worldWorkerPage";
import type {CellWorldDisplay, PixelWorldDisplay, WorldWorker} from "./worldWorkerPage";
import {
    DEFAULT_RENDER_BACKEND,
    FIXED_FRAMEBUFFER_LIMITS,
    FIXED_TERMINAL_LIMITS,
    fixedFramebufferSizeFromQuery,
    fixedTerminalSizeFromQuery,
    isPageToWorldMessage,
    isSurfaceSize,
    isWorldToPageMessage,
    PIXEL_SCALE_LIMITS,
    pixelScaleFromQuery,
    renderBackendFromQuery,
    requestedRasterWorkersFromQuery,
} from "./worldWorkerProtocol";
import type {CellSurfaceSize, PageToWorldMessage, PixelSurfaceSize, WorldToPageMessage} from "./worldWorkerProtocol";
import {MemoryFileSource, MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {WORKER_ENTRY_POINT} from "../../engine/platform/platform";
import {CellPresenterResource} from "../../backends/cells/cellPresenterResource";
import {cellFrameBuffers, CellKind} from "../../backends/cells/cellFrame";
import type {CellFrame} from "../../backends/cells/cellFrame";
import {ScreenBuffer} from "../../backends/cells/cellGrid";
import {CellRenderSettings} from "../../backends/cells/cellRenderSettings";
import {inflate} from "../../engine/assets/image/inflate";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {TextColor} from "../../engine/rendering/textColor";
import {CellRenderSystemGroup} from "../../backends/cells/cellRenderSystemGroup";
import {PixelPresenterResource} from "../../backends/pixels/pixelPresenterResource";
import {pixelFrameBuffers, RGBA_BYTES_PER_PIXEL} from "../../backends/pixels/pixelFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {PixelRenderSystemGroup} from "../../backends/pixels/pixelRenderSystemGroup";
import {Input} from "../../engine/input/input";
import {Key} from "../../engine/input/key";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import type {InputEvent} from "../../engine/input/inputEvent";

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

interface PostedMessage {
    readonly message: WorldToPageMessage;
    readonly transfer: readonly ArrayBuffer[];
}

class FakeScope implements WorldWorkerScope {
    public readonly sent: PostedMessage[] = [];
    public readonly navigator = {hardwareConcurrency: 6};
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public constructor(host: BrowserWorkerHost = {}) {
        Object.assign(this, host);
    }

    public get posted(): WorldToPageMessage[] {
        return this.sent.map(entry => entry.message);
    }

    public postMessage(message: WorldToPageMessage, transfer: ArrayBuffer[] = []): void {
        this.sent.push({message, transfer});
    }

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.push(listener);
    }

    public send(message: PageToWorldMessage): void {
        for (const listener of [...this.listeners]) listener({data: message});
    }
}

const CELL_SURFACE: CellSurfaceSize = {kind: "cells", columns: 100, rows: 30};
const PIXEL_SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 64, heightPx: 32};
const INIT: PageToWorldMessage = {type: "init", surface: CELL_SURFACE, requestedRasterWorkers: 2};
const PIXEL_INIT: PageToWorldMessage = {type: "init", surface: PIXEL_SURFACE, requestedRasterWorkers: 2};
const UP_PRESSED: InputEvent = {type: "keyDown", key: Key.Up, repeat: false, ...NO_MODIFIERS};
const UP_RELEASED: InputEvent = {type: "keyUp", key: Key.Up, ...NO_MODIFIERS};
const TYPED_X: InputEvent = {type: "text", text: "x"};
const LETTER_A = 0x41;
const PIXELS_PER_SCREEN_UNIT_X = 8;
const PIXELS_PER_SCREEN_UNIT_Y = 16;
const FIRST_RED = 7;

async function openConnection(scope: FakeScope = new FakeScope(), files = new MemoryFileSource(), init: PageToWorldMessage = INIT): Promise<PageConnection> {
    const opening = PageConnection.open(scope, files);
    scope.send(init);
    return await opening;
}

function openPixelConnection(scope: FakeScope = new FakeScope()): Promise<PageConnection> {
    return openConnection(scope, new MemoryFileSource(), PIXEL_INIT);
}

function pixelFrame(widthPx: number, heightPx: number, firstRed: number = FIRST_RED): PixelFrame {
    const rgba = new Uint8ClampedArray(widthPx * heightPx * RGBA_BYTES_PER_PIXEL);
    rgba[0] = firstRed;
    return {widthPx, heightPx, rgba, pixelsPerScreenUnitX: PIXELS_PER_SCREEN_UNIT_X, pixelsPerScreenUnitY: PIXELS_PER_SCREEN_UNIT_Y};
}

function frameWithText(columns: number, rows: number, glyph: number = LETTER_A): CellFrame {
    const screenSize = new ScreenSize();
    screenSize.x = columns;
    screenSize.y = rows;
    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize}, CellRenderSettings.DEFAULT_BACKGROUND_STYLE);
    buffer.setText(0, 0, 0, glyph, TextColor.GREEN, TextColor.DEFAULT);
    return buffer.toCellFrame();
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

class FakeDisplaySurface<Frame> {
    public readonly shown: string[] = [];
    public readonly frames: Frame[] = [];
    public readonly unpresented: (() => void)[] = [];
    public readonly resizeListeners = new Set<() => void>();

    public onResize(listener: () => void): () => void {
        this.resizeListeners.add(listener);
        return () => {
            this.resizeListeners.delete(listener);
        };
    }

    public showStatus(text: string): void {
        this.shown.push(text);
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }

    public presentAll(): void {
        for (const callback of this.unpresented.splice(0)) callback();
    }

    protected record(frame: Frame, onPresented: () => void): void {
        this.frames.push(frame);
        this.unpresented.push(onPresented);
    }

    protected notifyResize(): void {
        for (const listener of [...this.resizeListeners]) listener();
    }
}

class FakeDisplay extends FakeDisplaySurface<CellFrame> implements CellWorldDisplay {
    public columnCount = 120;
    public rowCount = 40;

    public surfaceSize(): CellSurfaceSize {
        return {kind: "cells", columns: this.columnCount, rows: this.rowCount};
    }

    public presentCells(frame: CellFrame, onPresented: () => void): void {
        this.record(frame, onPresented);
    }

    public resize(columns: number, rows: number): void {
        this.columnCount = columns;
        this.rowCount = rows;
        this.notifyResize();
    }
}

class FakePixelDisplay extends FakeDisplaySurface<PixelFrame> implements PixelWorldDisplay {
    public widthPx = 320;
    public heightPx = 160;

    public surfaceSize(): PixelSurfaceSize {
        return {kind: "pixels", widthPx: this.widthPx, heightPx: this.heightPx};
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.record(frame, onPresented);
    }

    public resize(widthPx: number, heightPx: number): void {
        this.widthPx = widthPx;
        this.heightPx = heightPx;
        this.notifyResize();
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

    test("?backend= picks cells or pixels; anything else is the cells default", () => {
        expect(DEFAULT_RENDER_BACKEND).toBe("cells");
        expect(renderBackendFromQuery("?backend=pixels")).toBe("pixels");
        expect(renderBackendFromQuery("?threads=2&backend=cells")).toBe("cells");
        expect(renderBackendFromQuery("?backend=%20pixels%20")).toBe("pixels");
        expect(renderBackendFromQuery("")).toBe("cells");
        expect(renderBackendFromQuery("?backend=")).toBe("cells");
        expect(renderBackendFromQuery("?backend=Pixels")).toBe("cells");
        expect(renderBackendFromQuery("?backend=webgl")).toBe("cells");
    });

    test("?scale= is a whole number of device pixels per framebuffer pixel within its limits", () => {
        const {min, max} = PIXEL_SCALE_LIMITS;
        expect(pixelScaleFromQuery("?scale=3")).toBe(3);
        expect(pixelScaleFromQuery(`?backend=pixels&scale=${min}`)).toBe(min);
        expect(pixelScaleFromQuery(`?scale=${max}`)).toBe(max);
        expect(pixelScaleFromQuery(`?scale=${max + 1}`)).toBeUndefined();
        expect(pixelScaleFromQuery(`?scale=${min - 1}`)).toBeUndefined();
        expect(pixelScaleFromQuery("?scale=1.5")).toBeUndefined();
        expect(pixelScaleFromQuery("?scale=big")).toBeUndefined();
        expect(pixelScaleFromQuery("")).toBeUndefined();
    });

    test("?width= and ?height= fix each framebuffer side given in whole pixels within range; others fit the window", () => {
        const {minPx, maxPx} = FIXED_FRAMEBUFFER_LIMITS;
        expect(fixedFramebufferSizeFromQuery("?width=640&height=384")).toEqual({widthPx: 640, heightPx: 384});
        expect(fixedFramebufferSizeFromQuery("?backend=pixels&height=200")).toEqual({heightPx: 200});
        expect(fixedFramebufferSizeFromQuery("?width=320")).toEqual({widthPx: 320});
        expect(fixedFramebufferSizeFromQuery("")).toEqual({});
        expect(fixedFramebufferSizeFromQuery("?width=&height=")).toEqual({});
        expect(fixedFramebufferSizeFromQuery("?width=320.5&height=-200")).toEqual({});
        expect(fixedFramebufferSizeFromQuery(`?width=${minPx}&height=${maxPx}`)).toEqual({widthPx: minPx, heightPx: maxPx});
        expect(fixedFramebufferSizeFromQuery(`?width=${minPx - 1}&height=${maxPx + 1}`)).toEqual({});
        expect(fixedFramebufferSizeFromQuery("?cols=120&rows=40")).toEqual({});
    });

    test("each side only accepts the other side's message types", () => {
        const frame = frameWithText(2, 1);
        expect(isPageToWorldMessage({type: "init", surface: {kind: "cells", columns: 1, rows: 1}})).toBe(true);
        expect(isPageToWorldMessage({type: "presented"})).toBe(true);
        expect(isPageToWorldMessage({type: "frame", frame})).toBe(false);
        expect(isPageToWorldMessage({type: "pixelFrame", frame: pixelFrame(1, 1)})).toBe(false);
        expect(isWorldToPageMessage({type: "frame", frame})).toBe(true);
        expect(isWorldToPageMessage({type: "pixelFrame", frame: pixelFrame(1, 1)})).toBe(true);
        expect(isWorldToPageMessage({type: "status", text: "Loading"})).toBe(true);
        expect(isWorldToPageMessage({type: "inputEvents", events: []})).toBe(false);
        expect(isWorldToPageMessage(null)).toBe(false);
        expect(isWorldToPageMessage("frame")).toBe(false);
    });

    test("init and resize carry a cells or pixels surface, each checked field by field", () => {
        expect(isSurfaceSize(CELL_SURFACE)).toBe(true);
        expect(isSurfaceSize(PIXEL_SURFACE)).toBe(true);
        expect(isSurfaceSize({kind: "cells", columns: 0, rows: 0})).toBe(true);
        expect(isSurfaceSize({kind: "cells", widthPx: 10, heightPx: 10})).toBe(false);
        expect(isSurfaceSize({kind: "pixels", columns: 10, rows: 10})).toBe(false);
        expect(isSurfaceSize({kind: "pixels", widthPx: 10.5, heightPx: 10})).toBe(false);
        expect(isSurfaceSize({kind: "pixels", widthPx: -1, heightPx: 10})).toBe(false);
        expect(isSurfaceSize({kind: "canvas", widthPx: 10, heightPx: 10})).toBe(false);
        expect(isSurfaceSize(null)).toBe(false);
        expect(isPageToWorldMessage(INIT)).toBe(true);
        expect(isPageToWorldMessage(PIXEL_INIT)).toBe(true);
        expect(isPageToWorldMessage({type: "resize", surface: PIXEL_SURFACE})).toBe(true);
        expect(isPageToWorldMessage({type: "init", columns: 100, rows: 30})).toBe(false);
        expect(isPageToWorldMessage({type: "resize", columns: 100, rows: 30})).toBe(false);
        expect(isPageToWorldMessage({type: "resize", surface: {kind: "pixels", widthPx: "64", heightPx: 32}})).toBe(false);
    });

    test("pixel frames are checked by isPixelFrame", () => {
        const frame = pixelFrame(2, 2);
        expect(isWorldToPageMessage({type: "pixelFrame"})).toBe(false);
        expect(isWorldToPageMessage({type: "pixelFrame", frame: {...frame, widthPx: 3}})).toBe(false);
        expect(isWorldToPageMessage({type: "pixelFrame", frame: {...frame, rgba: Array.from(frame.rgba)}})).toBe(false);
        expect(isWorldToPageMessage({type: "pixelFrame", frame: {...frame, pixelsPerScreenUnitX: 0}})).toBe(false);
        expect(isWorldToPageMessage({type: "pixelFrame", frame: frameWithText(2, 2)})).toBe(false);
        expect(isWorldToPageMessage({type: "frame", frame})).toBe(false);
    });

    test("the old ANSI output and written messages are gone", () => {
        expect(isWorldToPageMessage({type: "output", data: "\x1b[H"})).toBe(false);
        expect(isPageToWorldMessage({type: "written"})).toBe(false);
    });

    test("frames, statuses and errors are checked field by field", () => {
        const frame = frameWithText(3, 2);
        expect(isWorldToPageMessage({type: "frame"})).toBe(false);
        expect(isWorldToPageMessage({type: "frame", frame: {...frame, height: 3}})).toBe(false);
        expect(isWorldToPageMessage({type: "frame", frame: {...frame, kind: Array.from(frame.kind)}})).toBe(false);
        expect(isWorldToPageMessage({type: "status"})).toBe(false);
        expect(isWorldToPageMessage({type: "status", text: 7})).toBe(false);
        expect(isWorldToPageMessage({type: "error", message: "boom"})).toBe(true);
        expect(isWorldToPageMessage({type: "error"})).toBe(false);
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
        const connection = await opening;
        const {platform} = connection;
        const presenter = connection.cellPresenter();
        expect(presenter.size()).toEqual({columns: 100, rows: 30});
        expect(platform.requestedRasterWorkers!()).toBe(2);
        expect(platform.hardwareConcurrency()).toBe(6);
        expect(platform.files).toBe(files);
        expect(platform.inflate).toBe(inflate);
        expect(Object.keys(presenter).sort()).toEqual(["backlogged", "onResize", "present", "size", "start", "stop"]);
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
        const presenter = (await openConnection(scope)).cellPresenter();
        let resizes = 0;
        const stop = presenter.onResize(() => resizes++);
        scope.send({type: "resize", surface: {kind: "cells", columns: 80, rows: 20}});
        expect(presenter.size()).toEqual({columns: 80, rows: 20});
        expect(resizes).toBe(1);
        stop();
        scope.send({type: "resize", surface: {kind: "cells", columns: 90, rows: 25}});
        expect(resizes).toBe(1);
        expect(presenter.size()).toEqual({columns: 90, rows: 25});
    });

    test("a pixel page opens a pixel presenter of the init size that follows pixel resizes", async () => {
        const scope = new FakeScope();
        const connection = await openPixelConnection(scope);
        const presenter = connection.pixelPresenter();
        expect(connection.pixelPresenter()).toBe(presenter);
        expect(presenter.size()).toEqual({widthPx: 64, heightPx: 32});
        expect(Object.keys(presenter).sort()).toEqual(["backlogged", "onResize", "present", "size", "start", "stop"]);
        let resizes = 0;
        presenter.onResize(() => resizes++);
        scope.send({type: "resize", surface: {kind: "pixels", widthPx: 128, heightPx: 48}});
        expect(presenter.size()).toEqual({widthPx: 128, heightPx: 48});
        expect(resizes).toBe(1);
        scope.send({type: "resize", surface: {kind: "cells", columns: 80, rows: 20}});
        expect(presenter.size()).toEqual({widthPx: 128, heightPx: 48});
        expect(resizes).toBe(1);
    });

    test("asking for the other backend's presenter throws, naming both surfaces", async () => {
        const cells = await openConnection();
        expect(() => cells.pixelPresenter()).toThrow("The page shows a cells surface, so this world cannot present pixels");
        expect(cells.cellPresenter()).toBe(cells.cellPresenter());
        const pixels = await openPixelConnection();
        expect(() => pixels.cellPresenter()).toThrow("The page shows a pixels surface, so this world cannot present cells");
        expect(() => pixels.cellPresenter()).toThrow("?backend=cells");
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

    test("each presented frame is posted at once as its own copy, with every buffer transferred", async () => {
        const scope = new FakeScope();
        const presenter = (await openConnection(scope)).cellPresenter();
        const frame = frameWithText(4, 2);
        presenter.present(frame, "full");
        expect(scope.sent.length).toBe(1);
        const {message, transfer} = scope.sent[0];
        if (message.type !== "frame") throw new Error(`expected a frame, got ${message.type}`);
        expect(message.frame).toEqual(frame);
        expect(isWorldToPageMessage(message)).toBe(true);
        expect(transfer).toEqual(cellFrameBuffers(message.frame));
        expect(cellFrameBuffers(frame).some(buffer => transfer.includes(buffer))).toBe(false);

        frame.glyph[0] = LETTER_A + 1;
        expect(message.frame.glyph[0]).toBe(LETTER_A);
    });

    test("each presented pixel frame is posted at once as its own copy, with its buffer transferred", async () => {
        const scope = new FakeScope();
        const presenter = (await openPixelConnection(scope)).pixelPresenter();
        const reusedBuffer = new ArrayBuffer(64 * 32 * RGBA_BYTES_PER_PIXEL * 2);
        const rgba = new Uint8ClampedArray(reusedBuffer, 0, 4 * 2 * RGBA_BYTES_PER_PIXEL);
        rgba[0] = FIRST_RED;
        const frame: PixelFrame = {widthPx: 4, heightPx: 2, rgba, pixelsPerScreenUnitX: PIXELS_PER_SCREEN_UNIT_X, pixelsPerScreenUnitY: PIXELS_PER_SCREEN_UNIT_Y};
        presenter.present(frame);
        expect(scope.sent.length).toBe(1);
        const {message, transfer} = scope.sent[0];
        if (message.type !== "pixelFrame") throw new Error(`expected a pixel frame, got ${message.type}`);
        expect(message.frame).toEqual(frame);
        expect(isWorldToPageMessage(message)).toBe(true);
        expect(transfer).toEqual(pixelFrameBuffers(message.frame));
        expect(transfer.length).toBe(1);
        expect(transfer[0]).not.toBe(reusedBuffer);
        expect(transfer[0].byteLength).toBe(rgba.length);

        rgba[0] = FIRST_RED + 1;
        expect(message.frame.rgba[0]).toBe(FIRST_RED);
    });

    test("statuses, quit and fail are posted in order", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        connection.showStatus("Loading assets: 1/2 files");
        connection.cellPresenter().present(frameWithText(1, 1), "full");
        connection.quit();
        connection.fail(new Error("boom"));
        connection.fail("plain");
        expect(scope.posted.map(message => message.type)).toEqual(["status", "frame", "quit", "error", "error"]);
        expect(scope.posted[0]).toEqual({type: "status", text: "Loading assets: 1/2 files"});
        expect(scope.posted.slice(3)).toEqual([{type: "error", message: "boom"}, {type: "error", message: "plain"}]);
    });

    test("the presenter is backlogged while two frames wait for the page to present them", async () => {
        const scope = new FakeScope();
        const presenter = (await openConnection(scope)).cellPresenter();
        const frame = frameWithText(2, 1);
        expect(presenter.backlogged!()).toBe(false);
        presenter.present(frame, "full");
        expect(presenter.backlogged!()).toBe(false);
        presenter.present(frame, "changes");
        expect(presenter.backlogged!()).toBe(true);
        scope.send({type: "presented"});
        expect(presenter.backlogged!()).toBe(false);
        scope.send({type: "presented"});
        scope.send({type: "presented"});
        presenter.present(frame, "changes");
        presenter.present(frame, "changes");
        expect(presenter.backlogged!()).toBe(true);
    });

    test("the pixel presenter has the same backpressure: two unacknowledged frames, released by presented", async () => {
        const scope = new FakeScope();
        const presenter = (await openPixelConnection(scope)).pixelPresenter();
        const frame = pixelFrame(2, 1);
        expect(presenter.backlogged!()).toBe(false);
        presenter.present(frame);
        expect(presenter.backlogged!()).toBe(false);
        presenter.present(frame);
        expect(presenter.backlogged!()).toBe(true);
        scope.send({type: "presented"});
        expect(presenter.backlogged!()).toBe(false);
        scope.send({type: "presented"});
        scope.send({type: "presented"});
        presenter.present(frame);
        presenter.present(frame);
        expect(presenter.backlogged!()).toBe(true);
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

class FrameProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

describe("CellRenderSystemGroup on the page connection", () => {
    test("posts one frame per tick, skips ticks while two frames are unpresented and resumes after an ack", async () => {
        const scope = new FakeScope();
        const connection = await openConnection(scope);
        const world = new World({platform: new MemoryPlatform()});
        world.resources.insert(new CellPresenterResource(connection.cellPresenter()));
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(FrameProbeSystem);
        try {
            const frames = () => scope.posted.filter(message => message.type === "frame").length;
            expect(frames()).toBe(1);
            root.update();
            expect(frames()).toBe(2);
            const ticksBefore = probe.frames;
            root.update();
            root.update();
            expect(frames()).toBe(2);
            expect(probe.frames).toBe(ticksBefore);

            scope.send({type: "presented"});
            root.update();
            expect(frames()).toBe(3);
            expect(probe.frames).toBe(ticksBefore + 1);

            const last = scope.posted[scope.posted.length - 1];
            if (last.type !== "frame") throw new Error(`expected a frame, got ${last.type}`);
            expect([last.frame.width, last.frame.height]).toEqual([100, 29]);
            expect(last.frame.kind.every(kind => kind === CellKind.Background)).toBe(true);
        } finally {
            group.enabled = false;
        }
    });
});

class PixelFrameProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

describe("PixelRenderSystemGroup on the page connection", () => {
    test("posts one pixel frame of the page's size per tick, skips ticks while two are unpresented and resumes after an ack", async () => {
        const scope = new FakeScope();
        const connection = await openPixelConnection(scope);
        const world = new World({platform: new MemoryPlatform()});
        world.resources.insert(new PixelPresenterResource(connection.pixelPresenter()));
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelFrameProbeSystem);
        try {
            const frames = () => scope.posted.filter(message => message.type === "pixelFrame").length;
            expect(frames()).toBe(1);
            root.update();
            expect(frames()).toBe(2);
            const ticksBefore = probe.frames;
            root.update();
            root.update();
            expect(frames()).toBe(2);
            expect(probe.frames).toBe(ticksBefore);

            scope.send({type: "presented"});
            scope.send({type: "resize", surface: {kind: "pixels", widthPx: 96, heightPx: 48}});
            root.update();
            expect(frames()).toBe(3);
            expect(probe.frames).toBe(ticksBefore + 1);

            const last = scope.posted[scope.posted.length - 1];
            if (last.type !== "pixelFrame") throw new Error(`expected a pixel frame, got ${last.type}`);
            expect([last.frame.widthPx, last.frame.heightPx]).toEqual([96, 48]);
            expect(isWorldToPageMessage(last)).toBe(true);
            expect(scope.posted.some(message => message.type === "frame")).toBe(false);
        } finally {
            group.enabled = false;
        }
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
    test("shows that it is starting, then sends init with the display's size, input events, resizes and pagehide", async () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(display, worker, {name: "the 3D demo", requestedRasterWorkers: 3});
        expect(display.shown).toEqual([startingStatus("the 3D demo")]);
        page.input.enqueue(UP_PRESSED);
        await nextTask();
        display.resize(90, 20);
        page.exit();
        expect(worker.posted).toEqual([
            {type: "init", surface: {kind: "cells", columns: 120, rows: 40}, requestedRasterWorkers: 3},
            {type: "inputEvents", events: [UP_PRESSED]},
            {type: "resize", surface: {kind: "cells", columns: 90, rows: 20}},
            {type: "exit"},
        ]);
    });

    test("a pixel display sends its framebuffer size in init and resize, and presents pixel frames with an ack each", () => {
        const display = new FakePixelDisplay();
        const worker = new FakeWorldWorker();
        connectWorldWorker(display, worker, {name: "the 2D demo", requestedRasterWorkers: 2});
        display.resize(640, 384);
        const first = pixelFrame(2, 1);
        const second = pixelFrame(2, 1, FIRST_RED + 1);
        worker.emit({type: "pixelFrame", frame: first});
        worker.emit({type: "pixelFrame", frame: second});
        worker.emit({type: "pixelFrame", frame: {...first, heightPx: 2}} as WorldToPageMessage);
        expect(display.frames).toEqual([first, second]);
        display.presentAll();
        expect(worker.posted).toEqual([
            {type: "init", surface: {kind: "pixels", widthPx: 320, heightPx: 160}, requestedRasterWorkers: 2},
            {type: "resize", surface: {kind: "pixels", widthPx: 640, heightPx: 384}},
            {type: "presented"},
            {type: "presented"},
        ]);
    });

    test("frames of the other backend are an error: the page says so and ends the worker", () => {
        const cells = new FakeDisplay();
        const cellsWorker = new FakeWorldWorker();
        connectWorldWorker(cells, cellsWorker, {name: "the 2D demo"});
        cellsWorker.emit({type: "pixelFrame", frame: pixelFrame(2, 1)});
        expect(cells.frames.length).toBe(0);
        expect(cells.shown[cells.shown.length - 1]).toBe(`error: ${surfaceMismatchMessage("the 2D demo", "pixels", "cells")}`);
        expect(cellsWorker.terminated).toBe(true);
        expect(cells.resizeListeners.size).toBe(0);

        const pixels = new FakePixelDisplay();
        const pixelsWorker = new FakeWorldWorker();
        connectWorldWorker(pixels, pixelsWorker, {name: "the 3D demo"});
        pixelsWorker.emit({type: "frame", frame: frameWithText(2, 1)});
        pixelsWorker.emit({type: "pixelFrame", frame: pixelFrame(2, 1)});
        expect(pixels.frames.length).toBe(0);
        expect(pixels.shown[pixels.shown.length - 1]).toBe("error: the 3D demo sent cells frames, but this page shows pixels");
        expect(pixelsWorker.terminated).toBe(true);
        expect(pixelsWorker.posted.filter(message => message.type === "presented").length).toBe(0);
    });

    test("input events of one task go out as one message when the task ends", async () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(display, worker, {name: "the demo"});
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

    test("presents each frame and acknowledges it once the display has presented it", () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        connectWorldWorker(display, worker, {name: "the demo"});
        const first = frameWithText(3, 2);
        const second = frameWithText(3, 2, LETTER_A + 1);
        worker.emit({type: "frame", frame: first});
        worker.emit({type: "frame", frame: second});
        expect(display.frames).toEqual([first, second]);
        expect(worker.posted.filter(message => message.type === "presented").length).toBe(0);
        display.presentAll();
        expect(worker.posted.filter(message => message.type === "presented").length).toBe(2);
    });

    test("statuses from the world are shown, and malformed frames are ignored", () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        connectWorldWorker(display, worker, {name: "the demo"});
        worker.emit({type: "status", text: "Loading assets: 3/9 files, 1.0/4.0 MB"});
        worker.emit({type: "frame", frame: {...frameWithText(2, 2), width: 3}} as WorldToPageMessage);
        expect(display.shown.slice(1)).toEqual(["Loading assets: 3/9 files, 1.0/4.0 MB"]);
        expect(display.frames.length).toBe(0);
    });

    test("quit: says it stopped, stops forwarding and terminates the worker", async () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        const page = connectWorldWorker(display, worker, {name: "the demo"});
        worker.emit({type: "frame", frame: frameWithText(2, 1)});
        worker.emit({type: "quit"});
        expect(worker.terminated).toBe(true);
        expect(display.shown[display.shown.length - 1]).toBe(STOPPED_STATUS);
        expect(display.resizeListeners.size).toBe(0);

        const sent = worker.posted.length;
        display.presentAll();
        page.exit();
        page.input.enqueue(UP_PRESSED);
        await nextTask();
        worker.emit({type: "frame", frame: frameWithText(2, 1)});
        worker.emit({type: "status", text: "late"});
        expect(worker.posted.length).toBe(sent);
        expect(display.frames.length).toBe(1);
        expect(display.shown[display.shown.length - 1]).toBe(STOPPED_STATUS);
    });

    test("quit runs onQuit once, after the stopped status; an error does not", () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        const shownAtQuit: string[] = [];
        connectWorldWorker(display, worker, {name: "the demo", onQuit: () => shownAtQuit.push(display.shown[display.shown.length - 1])});
        worker.emit({type: "quit"});
        worker.emit({type: "quit"});
        expect(shownAtQuit).toEqual([STOPPED_STATUS]);

        const failing = new FakeWorldWorker();
        let quits = 0;
        connectWorldWorker(new FakeDisplay(), failing, {name: "the demo", onQuit: () => quits++});
        failing.emit({type: "error", message: "kaboom"});
        expect(quits).toBe(0);
    });

    test("a startup failure is shown as an error and ends the worker; an uncaught error is shown", () => {
        const display = new FakeDisplay();
        const worker = new FakeWorldWorker();
        connectWorldWorker(display, worker, {name: "the 3D demo"});
        worker.crash("kaboom");
        expect(display.shown[1]).toBe("error: Error in the 3D demo: kaboom");
        expect(worker.terminated).toBe(false);
        worker.emit({type: "error", message: "manifest missing"});
        expect(display.shown[2]).toBe("error: Could not start the 3D demo: manifest missing");
        expect(worker.terminated).toBe(true);
    });
});
