import {describe, expect, test} from "../../../engine/testing/harness";
import {MemoryPlatform, MemoryTerminal} from "../../../engine/testing/memoryPlatform";
import {Input, Key, NO_MODIFIERS, PointerButton} from "../../../engine/input";
import type {InputEvent, InputEventSink, KeyDownEvent, Modifiers} from "../../../engine/input";
import {TerminalInput} from "./terminalInput";
import type {TerminalInputOptions} from "./terminalInput";

const SHORT_RELEASE_DELAY_MS = 5;
const LONGER_THAN_RELEASE_DELAY_MS = 30;
const MOUSE_OFF = false;

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

class RecordingSink implements InputEventSink {
    public readonly events: InputEvent[] = [];

    public enqueue(event: InputEvent): void {
        this.events.push(event);
    }

    public keyDowns(): KeyDownEvent[] {
        return this.events.filter((event): event is KeyDownEvent => event.type === "keyDown");
    }
}

function terminalInput(options: Partial<TerminalInputOptions> & {readonly terminal: MemoryTerminal}): {input: TerminalInput, sink: RecordingSink, platform: MemoryPlatform} {
    const sink = new RecordingSink();
    const platform = new MemoryPlatform();
    const input = new TerminalInput({platform, sink, keyReleaseDelayMs: SHORT_RELEASE_DELAY_MS, ...options});
    return {input, sink, platform};
}

function keyDown(key: Key, modifiers: Partial<Modifiers> = {}, repeat = false): KeyDownEvent {
    return {type: "keyDown", key, repeat, ...NO_MODIFIERS, ...modifiers};
}

describe("TerminalInput keys", () => {
    test("terminal bytes become key events in a world's Input", () => {
        const terminal = new MemoryTerminal();
        const world = new Input();
        const input = new TerminalInput({terminal, platform: new MemoryPlatform(), sink: world, mouse: MOUSE_OFF}).start();
        try {
            terminal.feed("\x1b[A");
            terminal.feed("W");
            terminal.feed("\x1b[1;5C");
            world.beginFrame();
            expect(world.keyPressed(Key.Up)).toBe(true);
            expect(world.keyHeld(Key.W)).toBe(true);
            expect(world.events.filter(event => event.type === "keyDown")).toEqual([
                keyDown(Key.Up),
                keyDown(Key.W, {shift: true}),
                keyDown(Key.Right, {ctrl: true}),
            ]);
            expect(world.events.filter(event => event.type === "text")).toEqual([{type: "text", text: "W"}]);
        } finally {
            input.stop();
        }
    });

    test("named keys, control letters, alt and punctuation map to Key members", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed("\r\n\t\x7f \x1b[3~\x1b[5~\x1bOP\x1b[24~");
        terminal.feed("\x03\x1bx[]{-=_");
        input.stop();
        expect(sink.keyDowns().map(event => event.key)).toEqual([
            Key.Enter, Key.Enter, Key.Tab, Key.Backspace, Key.Space, Key.Delete, Key.PageUp, Key.F1, Key.F12,
            Key.C, Key.X, Key.BracketLeft, Key.BracketRight, Key.BracketLeft, Key.Minus, Key.Equal, Key.Minus,
        ]);
        const [ctrlC, altX, , , shiftedBracket] = sink.keyDowns().slice(9);
        expect([ctrlC.ctrl, altX.alt, shiftedBracket.shift]).toEqual([true, true, true]);
    });

    test("only printable characters typed without ctrl or alt become text; others are text only", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed("a \r\x03\x1bxé");
        input.stop();
        expect(sink.events.filter(event => event.type === "text")).toEqual([
            {type: "text", text: "a"}, {type: "text", text: " "}, {type: "text", text: "é"},
        ]);
        expect(sink.keyDowns().map(event => event.key)).toEqual([Key.A, Key.Space, Key.Enter, Key.C, Key.X]);
    });

    test("a key arriving again before the release delay repeats; silence releases it", async () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        try {
            terminal.feed("w");
            terminal.feed("w");
            expect(sink.keyDowns().map(event => event.repeat)).toEqual([false, true]);
            await sleep(LONGER_THAN_RELEASE_DELAY_MS);
            expect(sink.events.filter(event => event.type === "keyUp")).toEqual([{type: "keyUp", key: Key.W, ...NO_MODIFIERS}]);
            terminal.feed("w");
            expect(sink.keyDowns()[2].repeat).toBe(false);
        } finally {
            input.stop();
        }
    });

    test("scripted bytes waiting before start reach the sink", () => {
        const terminal = new MemoryTerminal({input: ["\x03"]});
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        input.stop();
        expect(sink.keyDowns()[0]).toEqual(keyDown(Key.C, {ctrl: true}));
    });

    test("a sink that stops input while scripted bytes arrive leaves it stopped", () => {
        const terminal = new MemoryTerminal({input: ["\x03", "x"]});
        const platform = new MemoryPlatform();
        const seen: InputEvent[] = [];
        const input: TerminalInput = new TerminalInput({
            terminal,
            platform,
            sink: {
                enqueue(event: InputEvent): void {
                    seen.push(event);
                    if (event.type === "keyDown" && event.ctrl && event.key === Key.C) input.stop();
                },
            },
        });
        input.start();
        expect(input.running).toBe(false);
        expect(terminal.started).toBe(false);
        expect(seen).toEqual([keyDown(Key.C, {ctrl: true}), {type: "keyUp", key: Key.C, ...NO_MODIFIERS}]);
        expect(terminal.text().includes("\x1b[?1003h")).toBe(false);
        platform.exit();
        expect(input.running).toBe(false);
    });

    test("stopping releases every key still waiting for its synthetic release", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF, keyReleaseDelayMs: 60_000});
        input.start();
        terminal.feed("ab");
        input.stop();
        expect(sink.events.filter(event => event.type === "keyUp").map(event => (event as {key: Key}).key)).toEqual([Key.A, Key.B]);
    });
});

describe("TerminalInput mouse", () => {
    test("mouse reports are split from key bytes in arrival order, at 0-based cells", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal});
        input.start();
        terminal.feed("a\x1b[<0;10;5Mb");
        input.stop();
        expect(sink.events.slice(0, 5)).toEqual([
            keyDown(Key.A),
            {type: "text", text: "a"},
            {type: "pointerDown", button: PointerButton.Left, x: 9, y: 4, ...NO_MODIFIERS},
            keyDown(Key.B),
            {type: "text", text: "b"},
        ]);
    });

    test("motion, release, wheel and modifier bits", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal});
        input.start();
        terminal.feed("\x1b[<2;1;1M\x1b[<34;3;2M\x1b[<35;4;2M\x1b[<2;4;2m\x1b[<64;5;5M\x1b[<65;5;5M\x1b[<28;2;2M");
        input.stop();
        expect(sink.events).toEqual([
            {type: "pointerDown", button: PointerButton.Right, x: 0, y: 0, ...NO_MODIFIERS},
            {type: "pointerMove", x: 2, y: 1, ...NO_MODIFIERS},
            {type: "pointerMove", x: 3, y: 1, ...NO_MODIFIERS},
            {type: "pointerUp", button: PointerButton.Right, x: 3, y: 1, ...NO_MODIFIERS},
            {type: "wheel", delta: 1, x: 4, y: 4, ...NO_MODIFIERS},
            {type: "wheel", delta: -1, x: 4, y: 4, ...NO_MODIFIERS},
            {type: "pointerDown", button: PointerButton.Left, x: 1, y: 1, ctrl: true, alt: true, shift: true, meta: false},
            {type: "pointerUp", button: PointerButton.Left, x: 1, y: 1, ...NO_MODIFIERS},
        ]);
    });
});

describe("TerminalInput on a terminal input source", () => {
    test("terminal modes are written on start and undone on stop", () => {
        const terminal = new MemoryTerminal();
        const {input} = terminalInput({terminal, mouse: true, hideCursor: true});
        input.start();
        expect(terminal.started).toBe(true);
        expect(terminal.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l");
        input.stop();
        expect(terminal.started).toBe(false);
        expect(terminal.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l\x1b[?1003l\x1b[?1006l\x1b[?25h");
    });

    test("host exit restores the terminal through the platform's exit hook", () => {
        const terminal = new MemoryTerminal();
        const {input, platform} = terminalInput({terminal});
        input.start();
        platform.exit();
        expect(input.running).toBe(false);
        expect(terminal.started).toBe(false);
        expect(terminal.text().endsWith("\x1b[?1003l\x1b[?1006l")).toBe(true);
    });

    test("a non-interactive terminal leaves input stopped", () => {
        const terminal = new MemoryTerminal({interactive: false});
        const {input} = terminalInput({terminal, noTTY: "silent"});
        input.start();
        expect(input.running).toBe(false);
        expect(terminal.started).toBe(false);
        expect(terminal.text()).toBe("");
        const {input: strict} = terminalInput({terminal, noTTY: "throw"});
        expect(() => strict.start()).toThrow("not a TTY");
    });

    test("start and stop are idempotent and input can restart", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start().start();
        input.stop().stop();
        input.start();
        terminal.feed("q");
        input.stop();
        expect(sink.keyDowns()).toEqual([keyDown(Key.Q)]);
    });
});
