import {describe, expect, test} from "../../../engine/testing/harness";
import {MemoryPlatform, MemoryTerminal} from "../../../engine/testing/memoryPlatform";
import {Input, Key, NO_MODIFIERS, PointerButton} from "../../../engine/input";
import type {InputEvent, InputEventSink, KeyDownEvent, KeyUpEvent, Modifiers} from "../../../engine/input";
import {TerminalInput} from "./terminalInput";
import type {TerminalInputOptions} from "./terminalInput";

const SHORT_RELEASE_DELAY_MS = 5;
const LONGER_THAN_RELEASE_DELAY_MS = 30;
const MOUSE_OFF = false;
const REPEATED = true;
const ENABLE_KEY_REPORTING = "\x1b[>27u\x1b[?9001h\x1b[?1004h\x1b[?u";
const RESTORE_KEY_REPORTING = "\x1b[?1004l\x1b[?9001l\x1b[<u";
const KITTY_FLAGS_WITH_EVENT_TYPES_REPLY = "\x1b[?27u";
const KITTY_FLAGS_WITHOUT_EVENT_TYPES_REPLY = "\x1b[?1u";

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

function keyUp(key: Key, modifiers: Partial<Modifiers> = {}): KeyUpEvent {
    return {type: "keyUp", key, ...NO_MODIFIERS, ...modifiers};
}

function text(typed: string): InputEvent {
    return {type: "text", text: typed};
}

const KEY_DOWN = 1;
const KEY_UP = 0;
const NO_CONTROL_KEYS = 0;
const SINGLE_PRESS = 1;
const THREE_PRESSES = 3;
const RIGHT_ALT_PRESSED = 0x1;
const LEFT_CTRL_PRESSED = 0x8;
const SHIFT_PRESSED = 0x10;
const ENHANCED_KEY = 0x100;
const NO_CHARACTER = 0;

const VK_RETURN = 0x0d;
const SCAN_RETURN = 0x1c;
const CHARACTER_RETURN = 0x0d;
const VK_SHIFT = 0x10;
const SCAN_LEFT_SHIFT = 0x2a;
const VK_CONTROL = 0x11;
const SCAN_LEFT_CTRL = 0x1d;
const VK_SPACE = 0x20;
const SCAN_SPACE = 0x39;
const CHARACTER_SPACE = 0x20;
const VK_UP = 0x26;
const SCAN_UP = 0x48;
const VK_1 = 0x31;
const SCAN_1 = 0x02;
const CHARACTER_EXCLAMATION_MARK = 0x21;
const VK_A = 0x41;
const SCAN_A = 0x1e;
const CHARACTER_A = 0x61;
const VK_C = 0x43;
const SCAN_C = 0x2e;
const CHARACTER_CTRL_C = 0x03;
const VK_Q = 0x51;
const SCAN_Q = 0x10;
const CHARACTER_AT_SIGN = 0x40;
const VK_W = 0x57;
const SCAN_W = 0x11;
const CHARACTER_W = 0x77;
const VK_OEM_2 = 0xbf;
const SCAN_SLASH = 0x35;
const CHARACTER_QUESTION_MARK = 0x3f;

function win32Key(virtualKey: number, scanCode: number, character: number, keyDown: number, controlKeyState = NO_CONTROL_KEYS, repeatCount = SINGLE_PRESS): string {
    return `\x1b[${virtualKey};${scanCode};${character};${keyDown};${controlKeyState};${repeatCount}_`;
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
            expect(input.keyProtocol).toBe("legacy");
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
        expect(terminal.text().includes(ENABLE_KEY_REPORTING)).toBe(false);
        expect(terminal.text().includes(RESTORE_KEY_REPORTING)).toBe(false);
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
        expect(terminal.text()).toBe(`\x1b[?1003h\x1b[?1006h\x1b[?25l${ENABLE_KEY_REPORTING}`);
        input.stop();
        expect(terminal.started).toBe(false);
        expect(terminal.text()).toBe(
            `\x1b[?1003h\x1b[?1006h\x1b[?25l${ENABLE_KEY_REPORTING}${RESTORE_KEY_REPORTING}\x1b[?1003l\x1b[?1006l\x1b[?25h`);
    });

    test("legacy key reporting writes only the mouse and cursor modes", () => {
        const terminal = new MemoryTerminal();
        const {input} = terminalInput({terminal, mouse: true, hideCursor: true, keyReporting: "legacy"});
        input.start();
        expect(terminal.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l");
        input.stop();
        expect(terminal.text()).toBe("\x1b[?1003h\x1b[?1006h\x1b[?25l\x1b[?1003l\x1b[?1006l\x1b[?25h");
    });

    test("host exit restores the terminal through the platform's exit hook, once", () => {
        const terminal = new MemoryTerminal();
        const {input, platform} = terminalInput({terminal});
        input.start();
        platform.exit();
        expect(input.running).toBe(false);
        expect(terminal.started).toBe(false);
        expect(terminal.text().endsWith(`${RESTORE_KEY_REPORTING}\x1b[?1003l\x1b[?1006l`)).toBe(true);
        input.stop();
        platform.exit();
        expect(terminal.text().split(RESTORE_KEY_REPORTING).length).toBe(2);
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

    test("stopping forgets the detected protocol and every reported key, so a restart detects again", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed(KITTY_FLAGS_WITH_EVENT_TYPES_REPLY);
        terminal.feed("\x1b[119u");
        input.stop();
        expect(input.keyProtocol).toBe("legacy");
        expect(sink.events).toEqual([keyDown(Key.W), text("w"), keyUp(Key.W)]);
        input.start();
        terminal.feed(win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_DOWN));
        expect(input.keyProtocol).toBe("win32InputMode");
        input.stop();
    });
});

describe("TerminalInput kitty keyboard protocol", () => {
    test("a flags reply with event types switches to reported releases: press, repeat and release of a letter", async () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        try {
            expect(input.keyProtocol).toBe("legacy");
            terminal.feed(KITTY_FLAGS_WITH_EVENT_TYPES_REPLY);
            expect(input.keyProtocol).toBe("kitty");
            terminal.feed("\x1b[119;;119u");
            terminal.feed("\x1b[119;1:2;119u");
            await sleep(LONGER_THAN_RELEASE_DELAY_MS);
            expect(sink.events).toEqual([keyDown(Key.W), text("w"), keyDown(Key.W, {}, REPEATED), text("w")]);
            terminal.feed("\x1b[119;1:3u");
            expect(sink.events.slice(4)).toEqual([keyUp(Key.W)]);
        } finally {
            input.stop();
        }
    });

    test("arrows in legacy and event-type forms, function keys, modified keys, keypad and shifted text", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed(KITTY_FLAGS_WITH_EVENT_TYPES_REPLY);
        terminal.feed("\x1b[A\x1b[1;1:3A");
        terminal.feed("\x1b[1;5:1C\x1b[1;5:3C");
        terminal.feed("\x1b[13~\x1b[13;1:3~");
        terminal.feed("\x1b[97;6u\x1b[97;6:3u");
        terminal.feed("\x1b[57441;2u\x1b[49;2;33u\x1b[49;2:3u\x1b[57441;1:3u");
        terminal.feed("\x1b[57399;;48u\x1b[57399;1:3u");
        terminal.feed("\x1b[99;5u\x1b[99;5:3u\x1b[27u\x1b[27;1:3u");
        const events = [...sink.events];
        input.stop();
        expect(events).toEqual([
            keyDown(Key.Up), keyUp(Key.Up),
            keyDown(Key.Right, {ctrl: true}), keyUp(Key.Right, {ctrl: true}),
            keyDown(Key.F3), keyUp(Key.F3),
            keyDown(Key.A, {ctrl: true, shift: true}), keyUp(Key.A, {ctrl: true, shift: true}),
            keyDown(Key.Num1, {shift: true}), text("!"), keyUp(Key.Num1, {shift: true}),
            keyDown(Key.Num0), text("0"), keyUp(Key.Num0),
            keyDown(Key.C, {ctrl: true}), keyUp(Key.C, {ctrl: true}),
            keyDown(Key.Escape), keyUp(Key.Escape),
        ]);
    });

    test("an event type proves reported releases without a flags reply; a press before it is still released", async () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        try {
            terminal.feed("\x1b[97u");
            expect(input.keyProtocol).toBe("legacy");
            terminal.feed("\x1b[97;1:3u");
            expect(input.keyProtocol).toBe("kitty");
            await sleep(LONGER_THAN_RELEASE_DELAY_MS);
            expect(sink.events).toEqual([keyDown(Key.A), text("a"), keyUp(Key.A)]);
        } finally {
            input.stop();
        }
    });

    test("a flags reply without event types keeps synthesizing releases", async () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        try {
            terminal.feed(KITTY_FLAGS_WITHOUT_EVENT_TYPES_REPLY);
            terminal.feed("\x1b[97;5u");
            terminal.feed("\x1b[A");
            expect(input.keyProtocol).toBe("legacy");
            await sleep(LONGER_THAN_RELEASE_DELAY_MS);
            expect(sink.events).toEqual([keyDown(Key.A, {ctrl: true}), keyDown(Key.Up), keyUp(Key.A), keyUp(Key.Up)]);
        } finally {
            input.stop();
        }
    });
});

describe("TerminalInput win32-input-mode", () => {
    test("a letter goes down, repeats while held and goes up only when reported", async () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        try {
            terminal.feed(win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_DOWN));
            expect(input.keyProtocol).toBe("win32InputMode");
            terminal.feed(win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_DOWN));
            await sleep(LONGER_THAN_RELEASE_DELAY_MS);
            expect(sink.events).toEqual([keyDown(Key.W), text("w"), keyDown(Key.W, {}, REPEATED), text("w")]);
            terminal.feed(win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_UP));
            expect(sink.events.slice(4)).toEqual([keyUp(Key.W)]);
        } finally {
            input.stop();
        }
    });

    test("arrows, space, Ctrl+C and a shifted punctuation key; bare modifier keys are ignored", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed(win32Key(VK_UP, SCAN_UP, NO_CHARACTER, KEY_DOWN, ENHANCED_KEY));
        terminal.feed(win32Key(VK_UP, SCAN_UP, NO_CHARACTER, KEY_UP, ENHANCED_KEY));
        terminal.feed(win32Key(VK_SPACE, SCAN_SPACE, CHARACTER_SPACE, KEY_DOWN));
        terminal.feed(win32Key(VK_SPACE, SCAN_SPACE, CHARACTER_SPACE, KEY_UP));
        terminal.feed(win32Key(VK_CONTROL, SCAN_LEFT_CTRL, NO_CHARACTER, KEY_DOWN, LEFT_CTRL_PRESSED));
        terminal.feed(win32Key(VK_C, SCAN_C, CHARACTER_CTRL_C, KEY_DOWN, LEFT_CTRL_PRESSED));
        terminal.feed(win32Key(VK_C, SCAN_C, CHARACTER_CTRL_C, KEY_UP, LEFT_CTRL_PRESSED));
        terminal.feed(win32Key(VK_CONTROL, SCAN_LEFT_CTRL, NO_CHARACTER, KEY_UP));
        terminal.feed(win32Key(VK_SHIFT, SCAN_LEFT_SHIFT, NO_CHARACTER, KEY_DOWN, SHIFT_PRESSED));
        terminal.feed(win32Key(VK_OEM_2, SCAN_SLASH, CHARACTER_QUESTION_MARK, KEY_DOWN, SHIFT_PRESSED));
        terminal.feed(win32Key(VK_OEM_2, SCAN_SLASH, CHARACTER_QUESTION_MARK, KEY_UP, SHIFT_PRESSED));
        terminal.feed(win32Key(VK_1, SCAN_1, CHARACTER_EXCLAMATION_MARK, KEY_DOWN, SHIFT_PRESSED));
        terminal.feed(win32Key(VK_1, SCAN_1, CHARACTER_EXCLAMATION_MARK, KEY_UP, SHIFT_PRESSED));
        terminal.feed(win32Key(VK_SHIFT, SCAN_LEFT_SHIFT, NO_CHARACTER, KEY_UP));
        const events = [...sink.events];
        input.stop();
        expect(events).toEqual([
            keyDown(Key.Up), keyUp(Key.Up),
            keyDown(Key.Space), text(" "), keyUp(Key.Space),
            keyDown(Key.C, {ctrl: true}), keyUp(Key.C, {ctrl: true}),
            keyDown(Key.Slash, {shift: true}), text("?"), keyUp(Key.Slash, {shift: true}),
            keyDown(Key.Num1, {shift: true}), text("!"), keyUp(Key.Num1, {shift: true}),
        ]);
    });

    test("Ctrl+C reaches a world's Input as the ctrl keyDown of C that quits the demos", () => {
        const terminal = new MemoryTerminal();
        const world = new Input();
        const input = new TerminalInput({terminal, platform: new MemoryPlatform(), sink: world, mouse: MOUSE_OFF}).start();
        try {
            terminal.feed(win32Key(VK_CONTROL, SCAN_LEFT_CTRL, NO_CHARACTER, KEY_DOWN, LEFT_CTRL_PRESSED));
            terminal.feed(win32Key(VK_C, SCAN_C, CHARACTER_CTRL_C, KEY_DOWN, LEFT_CTRL_PRESSED));
            world.beginFrame();
            expect(world.keyPressed(Key.C)).toBe(true);
            expect(world.events).toEqual([keyDown(Key.C, {ctrl: true})]);
        } finally {
            input.stop();
        }
    });

    test("AltGr text, a repeat count, and a key-up for a key pressed before start", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed(win32Key(VK_RETURN, SCAN_RETURN, CHARACTER_RETURN, KEY_UP));
        terminal.feed(win32Key(VK_Q, SCAN_Q, CHARACTER_AT_SIGN, KEY_DOWN, RIGHT_ALT_PRESSED | LEFT_CTRL_PRESSED));
        terminal.feed(win32Key(VK_A, SCAN_A, CHARACTER_A, KEY_DOWN, NO_CONTROL_KEYS, THREE_PRESSES));
        const events = [...sink.events];
        input.stop();
        expect(events).toEqual([
            keyDown(Key.Q, {ctrl: true, alt: true}), text("@"),
            keyDown(Key.A), text("aaa"),
        ]);
    });
});

describe("TerminalInput report parsing", () => {
    test("key reports, mouse reports and plain key bytes in one chunk keep their order", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal});
        input.start();
        terminal.feed(`${win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_DOWN)}\x1b[<0;10;5Mq\x1b[<0;10;5m${win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_UP)}`);
        const events = [...sink.events];
        input.stop();
        expect(events).toEqual([
            keyDown(Key.W), text("w"),
            {type: "pointerDown", button: PointerButton.Left, x: 9, y: 4, ...NO_MODIFIERS},
            keyDown(Key.Q), text("q"),
            {type: "pointerUp", button: PointerButton.Left, x: 9, y: 4, ...NO_MODIFIERS},
            keyUp(Key.W),
        ]);
    });

    test("a report split across chunks is held until it completes", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed("\x1b[?2");
        terminal.feed("7u\x1b[87;17;1");
        terminal.feed("19;1;0;1_\x1b");
        terminal.feed("[87;17;119;0;0;1_");
        const events = [...sink.events];
        input.stop();
        expect(events).toEqual([keyDown(Key.W), text("w"), keyUp(Key.W)]);
    });

    test("focus loss releases held keys; focus reports become focus events", () => {
        const terminal = new MemoryTerminal();
        const {input, sink} = terminalInput({terminal, mouse: MOUSE_OFF});
        input.start();
        terminal.feed(win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_DOWN));
        terminal.feed("\x1b[O");
        terminal.feed("\x1b[I");
        terminal.feed(win32Key(VK_W, SCAN_W, CHARACTER_W, KEY_UP));
        const events = [...sink.events];
        input.stop();
        expect(events).toEqual([
            keyDown(Key.W), text("w"), keyUp(Key.W),
            {type: "focus", focused: false}, {type: "focus", focused: true},
        ]);
    });
});
