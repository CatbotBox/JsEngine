import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import type {CellFrame} from "../../backends/cells/cellFrame";
import type {PixelFrame} from "../../backends/pixels/pixelFrame";
import {Key} from "../../engine/input/key";
import {PointerButton} from "../../engine/input/pointerButton";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import type {InputEvent, InputEventSink, Modifiers} from "../../engine/input/inputEvent";
import {TerminalInput} from "../../hosts/terminalInput/terminalInput";
import {installDomInput} from "../../hosts/web/domInput";
import type {CellArea, DomInputTarget, DomKeyboardEvent, DomListenerOptions, DomPointerEvent, DomWheelEvent} from "../../hosts/web/domInput";
import {displayBackendOf} from "../../hosts/web/worldWorkerPage";
import type {CellSurfaceSize, PixelSurfaceSize} from "../../hosts/web/worldWorkerProtocol";
import type {GameTarget} from "../project/editorSettings";
import {CellEditorViewport, GpuEditorViewport, NO_CELL_AREA, PixelEditorViewport} from "./editorViewport";
import type {SessionDisplayEvents, SessionGpuCanvas, SharedCellDisplay, SharedPixelDisplay} from "./editorViewport";
import {TerminalInputChannel, terminalInputMessage} from "./terminalInputChannel";
import type {TerminalInputPort} from "./terminalInputChannel";

const SURFACE: PixelSurfaceSize = {kind: "pixels", widthPx: 64, heightPx: 32};
const FRAME: PixelFrame = {widthPx: 1, heightPx: 1, rgba: new Uint8ClampedArray(4), pixelsPerScreenUnitX: 8, pixelsPerScreenUnitY: 16};
const VISIBLE = true;
const HIDDEN = false;
const SCREEN_UNIT_X = 8;
const SCREEN_UNIT_Y = 16;
const WEB_PIXELS: GameTarget = {target: "web", backend: "pixels"};
const WEB_GPU: GameTarget = {target: "web", backend: "gpu"};
const WEB_CELLS: GameTarget = {target: "web", backend: "cells"};
const TERMINAL: GameTarget = {target: "terminal", backend: "cells"};
const CELL_SURFACE: CellSurfaceSize = {kind: "cells", columns: 80, rows: 20};
const CELL_FRAME = {} as CellFrame;
const CELL_AREA: CellArea = {left: 10, top: 20, width: 800, height: 400, columns: 80, rows: 20};
const CELL_WIDTH_PX = 10;
const CELL_HEIGHT_PX = 20;
const SHORT_RELEASE_DELAY_MS = 5;
const LONGER_THAN_RELEASE_DELAY_MS = 40;
const POINTER_ID = 3;
const DOM_LEFT_BUTTON = 0;
const DOM_DELTA_PIXEL = 0;
const PIXELS_PER_WHEEL_NOTCH = 100;
const LEGACY_KEY_REPORTING = "legacy";
const PRESSED_AGAIN_BEFORE_RELEASE = true;

function areaOf(columns: number): CellArea {
    return {left: 0, top: 0, width: 10, height: 10, columns, rows: 1};
}

class RecordedEvents implements SessionDisplayEvents {
    public firstFrames = 0;
    public readonly failures: string[] = [];

    public firstFrame(): void {
        this.firstFrames++;
    }

    public failed(text: string): void {
        this.failures.push(text);
    }
}

class FakePixelDisplay implements SharedPixelDisplay {
    public readonly shown: string[] = [];
    public presented = 0;
    public visible = false;
    public disposed = false;

    public show(): void {
        this.visible = true;
    }

    public dispose(): void {
        this.disposed = true;
    }

    public surfaceSize(): PixelSurfaceSize {
        return SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentPixels(_frame: PixelFrame, onPresented: () => void): void {
        this.presented++;
        onPresented();
    }

    public showStatus(text: string): void {
        this.shown.push(`status: ${text}`);
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }

    public cellArea(): CellArea {
        return areaOf(1);
    }
}

class FakeGpuCanvas implements SessionGpuCanvas {
    public readonly shown: string[] = [];
    public readonly screenUnits: [number, number][] = [];
    public visible: boolean;
    public focused = false;
    public disposed = false;
    public transfers = 0;

    public constructor(visible: boolean, private readonly columns: number) {
        this.visible = visible;
    }

    public surfaceSize(): PixelSurfaceSize {
        return SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public transferCanvas(): OffscreenCanvas {
        this.transfers++;
        return {} as OffscreenCanvas;
    }

    public showScreenUnit(pixelsPerScreenUnitX: number, pixelsPerScreenUnitY: number): void {
        this.screenUnits.push([pixelsPerScreenUnitX, pixelsPerScreenUnitY]);
    }

    public showStatus(text: string): void {
        this.shown.push(`status: ${text}`);
    }

    public showError(text: string): void {
        this.shown.push(`error: ${text}`);
    }

    public cellArea(): CellArea {
        return areaOf(this.columns);
    }

    public show(): void {
        this.visible = true;
    }

    public hide(): void {
        this.visible = false;
        this.focused = false;
    }

    public hasFocus(): boolean {
        return this.focused;
    }

    public focus(): void {
        this.focused = this.visible;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

function gpuViewport(): {readonly viewport: GpuEditorViewport, readonly canvases: FakeGpuCanvas[]} {
    const canvases: FakeGpuCanvas[] = [];
    const viewport = new GpuEditorViewport(visible => {
        const canvas = new FakeGpuCanvas(visible, canvases.length + 1);
        canvases.push(canvas);
        return canvas;
    }, WEB_GPU);
    return {viewport, canvases};
}

describe("PixelEditorViewport", () => {
    test("every session shares the one pixel display; hidden sessions acknowledge frames without drawing them", () => {
        const display = new FakePixelDisplay();
        const viewport = new PixelEditorViewport(display, WEB_PIXELS);
        const events = new RecordedEvents();
        const hidden = viewport.sessionDisplay(HIDDEN, events);
        expect(displayBackendOf(hidden)).toBe("pixels");
        let acknowledged = 0;
        if (!("presentPixels" in hidden)) throw new Error("a pixel session display presents pixels");
        hidden.presentPixels(FRAME, () => acknowledged++);
        hidden.presentPixels(FRAME, () => acknowledged++);
        expect([display.presented, acknowledged, events.firstFrames]).toEqual([0, 2, 1]);
        hidden.showStatus("loading");
        hidden.showError("broken");
        expect(display.shown).toEqual([]);
        expect(events.failures).toEqual(["broken"]);
        expect(display.visible).toBe(false);
        hidden.show();
        expect(display.visible).toBe(true);
        hidden.presentPixels(FRAME, () => acknowledged++);
        expect(display.presented).toBe(1);
        expect(viewport.cellArea()).toEqual(areaOf(1));
        expect(viewport.gameTarget).toEqual(WEB_PIXELS);
    });

    test("a session's hide keeps the shared display for the next session; disposing the viewport removes it", () => {
        const display = new FakePixelDisplay();
        const viewport = new PixelEditorViewport(display, WEB_PIXELS);
        const current = viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        current.show();
        current.hide();
        current.dispose();
        expect([display.visible, display.disposed]).toEqual([true, false]);
        viewport.dispose();
        expect(display.disposed).toBe(true);
    });
});

describe("GpuEditorViewport", () => {
    test("each session gets its own canvas, transferred to its worker; the first screen unit is its first frame", () => {
        const {viewport, canvases} = gpuViewport();
        const events = new RecordedEvents();
        const session = viewport.sessionDisplay(VISIBLE, events);
        expect(displayBackendOf(session)).toBe("gpu");
        if (!("transferCanvas" in session)) throw new Error("a gpu session display transfers a canvas");
        session.transferCanvas();
        session.showScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y);
        session.showScreenUnit(SCREEN_UNIT_X, SCREEN_UNIT_Y);
        expect([canvases.length, canvases[0].transfers, events.firstFrames]).toEqual([1, 1, 1]);
        expect(canvases[0].screenUnits).toEqual([[SCREEN_UNIT_X, SCREEN_UNIT_Y], [SCREEN_UNIT_X, SCREEN_UNIT_Y]]);
        expect(viewport.cellArea()).toEqual(areaOf(1));
    });

    test("a hidden session's canvas stays hidden and quiet until it is shown, then takes over input mapping and focus", () => {
        const {viewport, canvases} = gpuViewport();
        const current = viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        canvases[0].focus();
        const reloadEvents = new RecordedEvents();
        const reloaded = viewport.sessionDisplay(HIDDEN, reloadEvents);
        expect(canvases[1].visible).toBe(false);
        reloaded.showStatus("Starting…");
        reloaded.showError("broken");
        expect(canvases[1].shown).toEqual([]);
        expect(reloadEvents.failures).toEqual(["broken"]);
        expect(viewport.cellArea()).toEqual(areaOf(1));

        current.hide();
        reloaded.show();
        current.dispose();
        expect([canvases[0].visible, canvases[0].disposed]).toEqual([false, true]);
        expect([canvases[1].visible, canvases[1].focused]).toEqual([true, true]);
        expect(viewport.cellArea()).toEqual(areaOf(2));
    });

    test("focus moves to the new canvas only when the old one had it", () => {
        const {viewport, canvases} = gpuViewport();
        const current = viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        const reloaded = viewport.sessionDisplay(HIDDEN, new RecordedEvents());
        current.hide();
        reloaded.show();
        expect(canvases[1].focused).toBe(false);
    });

    test("errors go to the shown session's canvas; with no session yet a canvas is made to show them", () => {
        const {viewport, canvases} = gpuViewport();
        expect(viewport.cellArea()).toEqual(NO_CELL_AREA);
        viewport.showError("no worker");
        expect(canvases.length).toBe(1);
        expect(canvases[0].shown).toEqual(["error: no worker"]);
        viewport.sessionDisplay(VISIBLE, new RecordedEvents());
        viewport.showError("worker failed");
        expect(canvases[1].shown).toEqual(["error: worker failed"]);
    });
});

class FakeCellDisplay implements SharedCellDisplay {
    public presented = 0;
    public visible = false;
    public disposed = false;

    public surfaceSize(): CellSurfaceSize {
        return CELL_SURFACE;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentCells(_frame: CellFrame, onPresented: () => void): void {
        this.presented++;
        onPresented();
    }

    public showStatus(): void {
    }

    public showError(): void {
    }

    public cellArea(): CellArea {
        return CELL_AREA;
    }

    public show(): void {
        this.visible = true;
    }

    public dispose(): void {
        this.disposed = true;
    }
}

class RecordingSink implements InputEventSink {
    public readonly events: InputEvent[] = [];

    public enqueue(event: InputEvent): void {
        this.events.push(event);
    }

    public take(): InputEvent[] {
        return this.events.splice(0);
    }
}

class FakeDomEvent {
    public ctrlKey = false;
    public altKey = false;
    public shiftKey = false;
    public metaKey = false;

    public preventDefault(): void {
    }

    public stopPropagation(): void {
    }
}

class FakeKeyboardEvent extends FakeDomEvent implements DomKeyboardEvent {
    public readonly repeat = false;

    public constructor(public readonly key: string, public readonly code: string, modifiers: Partial<Pick<DomKeyboardEvent, "ctrlKey" | "altKey" | "shiftKey">> = {}) {
        super();
        Object.assign(this, modifiers);
    }
}

class FakePointerEvent extends FakeDomEvent implements DomPointerEvent {
    public readonly pointerId = POINTER_ID;

    public constructor(public readonly button: number, public readonly clientX: number, public readonly clientY: number) {
        super();
    }
}

class FakeWheelEvent extends FakeDomEvent implements DomWheelEvent {
    public readonly deltaMode = DOM_DELTA_PIXEL;

    public constructor(public readonly deltaY: number, public readonly clientX: number, public readonly clientY: number) {
        super();
    }
}

class FakeElement implements DomInputTarget {
    private readonly listeners: {readonly type: string, readonly listener: (event: never) => void}[] = [];

    public addEventListener(type: string, listener: (event: never) => void, _options?: DomListenerOptions): void {
        this.listeners.push({type, listener});
    }

    public removeEventListener(): void {
    }

    public dispatch(type: string, event: object): void {
        for (const registration of this.listeners) {
            if (registration.type === type) (registration.listener as (event: object) => void)(event);
        }
    }
}

class FakeWorkerPort implements TerminalInputPort {
    private readonly listeners: ((event: {readonly data: unknown}) => void)[] = [];

    public addEventListener(_type: "message", listener: (event: {readonly data: unknown}) => void): void {
        this.listeners.push(listener);
    }

    public post(data: unknown): void {
        for (const listener of this.listeners) listener({data});
    }
}

interface TerminalSimulation {
    readonly element: FakeElement;
    readonly bytes: string[];
    readonly game: RecordingSink;
    readonly pageEvents: RecordingSink;
    readonly input: TerminalInput;
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

function simulate(gameTarget: GameTarget): TerminalSimulation {
    const port = new FakeWorkerPort();
    const game = new RecordingSink();
    const pageEvents = new RecordingSink();
    const input = new TerminalInput({
        terminal: new TerminalInputChannel(port),
        platform: new MemoryPlatform(),
        sink: game,
        keyReporting: LEGACY_KEY_REPORTING,
        keyReleaseDelayMs: SHORT_RELEASE_DELAY_MS,
    }).start();
    const viewport = new CellEditorViewport(new FakeCellDisplay(), gameTarget);
    const bytes: string[] = [];
    const sessionInput = viewport.sessionInput({
        events: pageEvents,
        terminalBytes: data => {
            bytes.push(data);
            port.post(terminalInputMessage(data));
        },
    });
    const element = new FakeElement();
    installDomInput(element, {sink: sessionInput, cellArea: () => viewport.cellArea()});
    return {element, bytes, game, pageEvents, input};
}

function pressed(simulation: TerminalSimulation, key: string, code: string, modifiers: Partial<Pick<DomKeyboardEvent, "ctrlKey" | "altKey" | "shiftKey">> = {}): void {
    simulation.element.dispatch("keydown", new FakeKeyboardEvent(key, code, modifiers));
    simulation.element.dispatch("keyup", new FakeKeyboardEvent(key, code, modifiers));
}

function keyDown(key: Key, modifiers: Partial<Modifiers> = {}): InputEvent {
    return {type: "keyDown", key, repeat: false, ...NO_MODIFIERS, ...modifiers};
}

function clientX(column: number): number {
    return CELL_AREA.left + column * CELL_WIDTH_PX + CELL_WIDTH_PX / 2;
}

function clientY(row: number): number {
    return CELL_AREA.top + row * CELL_HEIGHT_PX + CELL_HEIGHT_PX / 2;
}

describe("CellEditorViewport", () => {
    test("every cell session shares the one cell display; a hidden session acknowledges frames without drawing, and showing it shows the display", () => {
        const display = new FakeCellDisplay();
        const viewport = new CellEditorViewport(display, WEB_CELLS);
        const events = new RecordedEvents();
        const hidden = viewport.sessionDisplay(HIDDEN, events);
        expect(displayBackendOf(hidden)).toBe("cells");
        if (!("presentCells" in hidden)) throw new Error("a cell session display presents cells");
        let acknowledged = 0;
        hidden.presentCells(CELL_FRAME, () => acknowledged++);
        expect([display.presented, acknowledged, events.firstFrames, display.visible]).toEqual([0, 1, 1, false]);
        hidden.show();
        hidden.presentCells(CELL_FRAME, () => acknowledged++);
        expect([display.presented, acknowledged, display.visible]).toEqual([1, 2, true]);
        viewport.dispose();
        expect(display.disposed).toBe(true);
    });

    test("the web cells target hands input on as engine events; only the terminal target encodes it as terminal bytes", () => {
        const web = simulate(WEB_CELLS);
        pressed(web, "ArrowRight", "ArrowRight");
        expect(web.bytes).toEqual([]);
        expect(web.pageEvents.take().map(event => event.type)).toEqual(["keyDown", "keyUp"]);
        const terminal = simulate(TERMINAL);
        pressed(terminal, "ArrowRight", "ArrowRight");
        expect(terminal.pageEvents.events).toEqual([]);
        expect(terminal.bytes).toEqual(["\x1b[C"]);
        web.input.stop();
        terminal.input.stop();
    });

    test("DOM keys become legacy terminal bytes, and TerminalInput reads them back with key-ups synthesized after silence", async () => {
        const simulation = simulate(TERMINAL);
        pressed(simulation, "ArrowRight", "ArrowRight");
        expect(simulation.game.take()).toEqual([keyDown(Key.Right)]);
        await sleep(LONGER_THAN_RELEASE_DELAY_MS);
        expect(simulation.game.take()).toEqual([{type: "keyUp", key: Key.Right, ...NO_MODIFIERS}]);

        pressed(simulation, "a", "KeyA");
        pressed(simulation, "A", "KeyA", {shiftKey: true});
        pressed(simulation, "c", "KeyC", {ctrlKey: true});
        pressed(simulation, "x", "KeyX", {altKey: true});
        pressed(simulation, "ArrowUp", "ArrowUp", {ctrlKey: true});
        pressed(simulation, "F5", "F5");
        pressed(simulation, "Tab", "Tab", {shiftKey: true});
        pressed(simulation, "Enter", "Enter");
        pressed(simulation, "Shift", "ShiftLeft", {shiftKey: true});
        expect(simulation.bytes.slice(1)).toEqual(["a", "A", "\x03", "\x1bx", "\x1b[1;5A", "\x1b[15~", "\x1b[Z", "\r"]);
        const downs = simulation.game.take().filter(event => event.type !== "keyUp");
        expect(downs).toEqual([
            keyDown(Key.A), {type: "text", text: "a"},
            {...keyDown(Key.A, {shift: true}), repeat: PRESSED_AGAIN_BEFORE_RELEASE}, {type: "text", text: "A"},
            keyDown(Key.C, {ctrl: true}),
            keyDown(Key.X, {alt: true}),
            keyDown(Key.Up, {ctrl: true}),
            keyDown(Key.F5),
            keyDown(Key.Tab, {shift: true}),
            keyDown(Key.Enter),
        ]);
        expect(simulation.input.keyProtocol).toBe("legacy");
        simulation.input.stop();
    });

    test("pointer, wheel and focus become SGR mouse and focus reports that TerminalInput reads back on the same cells", () => {
        const simulation = simulate(TERMINAL);
        const {element} = simulation;
        element.dispatch("pointerdown", new FakePointerEvent(DOM_LEFT_BUTTON, clientX(5), clientY(2)));
        element.dispatch("pointermove", new FakePointerEvent(DOM_LEFT_BUTTON, clientX(5) + 1, clientY(2)));
        element.dispatch("pointermove", new FakePointerEvent(DOM_LEFT_BUTTON, clientX(6), clientY(2)));
        element.dispatch("pointerup", new FakePointerEvent(DOM_LEFT_BUTTON, clientX(6), clientY(2)));
        element.dispatch("wheel", new FakeWheelEvent(-PIXELS_PER_WHEEL_NOTCH / 2, clientX(1), clientY(1)));
        element.dispatch("wheel", new FakeWheelEvent(-PIXELS_PER_WHEEL_NOTCH / 2, clientX(1), clientY(1)));
        element.dispatch("pointerdown", new FakePointerEvent(DOM_LEFT_BUTTON, clientX(200), clientY(-3)));
        element.dispatch("focusout", {});
        expect(simulation.bytes).toEqual([
            "\x1b[<0;6;3M", "\x1b[<32;7;3M", "\x1b[<0;7;3m", "\x1b[<64;2;2M", "\x1b[<0;80;1M", "\x1b[O",
        ]);
        expect(simulation.game.take()).toEqual([
            {type: "pointerDown", button: PointerButton.Left, x: 5, y: 2, ...NO_MODIFIERS},
            {type: "pointerMove", x: 6, y: 2, ...NO_MODIFIERS},
            {type: "pointerUp", button: PointerButton.Left, x: 6, y: 2, ...NO_MODIFIERS},
            {type: "wheel", delta: 1, x: 1, y: 1, ...NO_MODIFIERS},
            {type: "pointerDown", button: PointerButton.Left, x: 79, y: 0, ...NO_MODIFIERS},
            {type: "pointerUp", button: PointerButton.Left, x: 79, y: 0, ...NO_MODIFIERS},
            {type: "focus", focused: false},
        ]);
        simulation.input.stop();
    });
});
