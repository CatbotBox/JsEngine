import {describe, expect, test} from "../../engine/testing/harness";
import {Key} from "../../engine/input/key";
import {PointerButton} from "../../engine/input/pointerButton";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import type {KeyDownEvent, Modifiers} from "../../engine/input/inputEvent";
import type {CellArea} from "../../hosts/web/domInput";
import {legacyKeyBytes, TerminalInputEncoder} from "./terminalInputEncoder";
import {isTerminalInputMessage, TERMINAL_INPUT_MESSAGE_TYPE, terminalInputMessage} from "./terminalInputChannel";

const AREA: CellArea = {left: 0, top: 0, width: 80, height: 24, columns: 80, rows: 24};
const NO_CELLS_YET: CellArea = {left: 0, top: 0, width: 0, height: 0, columns: 0, rows: 0};

function down(key: Key, modifiers: Partial<Modifiers> = {}): KeyDownEvent {
    return {type: "keyDown", key, repeat: false, ...NO_MODIFIERS, ...modifiers};
}

function encoder(area: CellArea = AREA): {readonly encoder: TerminalInputEncoder, readonly sent: string[]} {
    const sent: string[] = [];
    return {encoder: new TerminalInputEncoder(data => sent.push(data), () => area), sent};
}

describe("legacy key bytes", () => {
    test("cursor, editing and function keys use xterm's sequences, with the modifier parameter when modified", () => {
        expect([Key.Up, Key.Down, Key.Right, Key.Left, Key.Home, Key.End].map(key => legacyKeyBytes(down(key))))
            .toEqual(["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D", "\x1b[H", "\x1b[F"]);
        expect([Key.F1, Key.F4, Key.F5, Key.F12].map(key => legacyKeyBytes(down(key)))).toEqual(["\x1bOP", "\x1bOS", "\x1b[15~", "\x1b[24~"]);
        expect([Key.Insert, Key.Delete, Key.PageUp, Key.PageDown].map(key => legacyKeyBytes(down(key)))).toEqual(["\x1b[2~", "\x1b[3~", "\x1b[5~", "\x1b[6~"]);
        expect(legacyKeyBytes(down(Key.Left, {shift: true}))).toBe("\x1b[1;2D");
        expect(legacyKeyBytes(down(Key.F1, {alt: true}))).toBe("\x1b[1;3P");
        expect(legacyKeyBytes(down(Key.Delete, {ctrl: true, shift: true}))).toBe("\x1b[3;6~");
    });

    test("Enter, Tab, Backspace and Escape send their control bytes; Alt prefixes ESC", () => {
        expect(legacyKeyBytes(down(Key.Enter))).toBe("\r");
        expect(legacyKeyBytes(down(Key.Tab))).toBe("\t");
        expect(legacyKeyBytes(down(Key.Tab, {shift: true}))).toBe("\x1b[Z");
        expect(legacyKeyBytes(down(Key.Backspace))).toBe("\x7f");
        expect(legacyKeyBytes(down(Key.Backspace, {ctrl: true}))).toBe("\b");
        expect(legacyKeyBytes(down(Key.Escape))).toBe("\x1b");
        expect(legacyKeyBytes(down(Key.Enter, {alt: true}))).toBe("\x1b\r");
    });

    test("Ctrl turns a character into its control byte, Alt prefixes ESC to the (shifted) character", () => {
        expect(legacyKeyBytes(down(Key.A, {ctrl: true}))).toBe("\x01");
        expect(legacyKeyBytes(down(Key.Z, {ctrl: true, shift: true}))).toBe("\x1a");
        expect(legacyKeyBytes(down(Key.Space, {ctrl: true}))).toBe("\x00");
        expect(legacyKeyBytes(down(Key.BracketLeft, {ctrl: true}))).toBe("\x1b");
        expect(legacyKeyBytes(down(Key.Num1, {ctrl: true}))).toBe("1");
        expect(legacyKeyBytes(down(Key.X, {alt: true}))).toBe("\x1bx");
        expect(legacyKeyBytes(down(Key.Num1, {alt: true, shift: true}))).toBe("\x1b!");
    });

    test("plain and AltGr characters, bare modifiers and Meta chords send nothing: the text event or the OS owns them", () => {
        expect(legacyKeyBytes(down(Key.A))).toBe("");
        expect(legacyKeyBytes(down(Key.A, {shift: true}))).toBe("");
        expect(legacyKeyBytes(down(Key.Q, {ctrl: true, alt: true}))).toBe("");
        expect(legacyKeyBytes(down(Key.Shift, {shift: true}))).toBe("");
        expect(legacyKeyBytes(down(Key.Up, {meta: true}))).toBe("");
    });
});

describe("terminal input encoder", () => {
    test("text and key-downs are sent, key-ups never are", () => {
        const {encoder: sink, sent} = encoder();
        sink.enqueue({type: "text", text: "é"});
        sink.enqueue({type: "keyUp", key: Key.Up, ...NO_MODIFIERS});
        sink.enqueue(down(Key.Up));
        expect(sent).toEqual(["é", "\x1b[A"]);
    });

    test("motion is reported once per cell, with the held button's code, and modifiers set their SGR bits", () => {
        const {encoder: sink, sent} = encoder();
        sink.enqueue({type: "pointerMove", x: 1.2, y: 0.5, ...NO_MODIFIERS});
        sink.enqueue({type: "pointerMove", x: 1.9, y: 0.9, ...NO_MODIFIERS});
        sink.enqueue({type: "pointerDown", button: PointerButton.Right, x: 1.9, y: 0.9, ...NO_MODIFIERS, ctrl: true});
        sink.enqueue({type: "pointerMove", x: 3, y: 0, ...NO_MODIFIERS, shift: true});
        sink.enqueue({type: "pointerUp", button: PointerButton.Right, x: 3, y: 0, ...NO_MODIFIERS});
        expect(sent).toEqual(["\x1b[<35;2;1M", "\x1b[<18;2;1M", "\x1b[<38;4;1M", "\x1b[<2;4;1m"]);
    });

    test("wheel notches accumulate across fractional events, one report per whole notch", () => {
        const {encoder: sink, sent} = encoder();
        sink.enqueue({type: "wheel", delta: 0.4, x: 0, y: 0, ...NO_MODIFIERS});
        sink.enqueue({type: "wheel", delta: 0.7, x: 0, y: 0, ...NO_MODIFIERS});
        sink.enqueue({type: "wheel", delta: -2.1, x: 0, y: 0, ...NO_MODIFIERS, alt: true});
        expect(sent).toEqual(["\x1b[<64;1;1M", "\x1b[<73;1;1M\x1b[<73;1;1M"]);
    });

    test("cells clamp to the terminal; before the first frame only the lower bound applies", () => {
        const {encoder: sink, sent} = encoder();
        sink.enqueue({type: "pointerDown", button: PointerButton.Left, x: -4, y: 99, ...NO_MODIFIERS});
        const before = encoder(NO_CELLS_YET);
        before.encoder.enqueue({type: "pointerDown", button: PointerButton.Left, x: 120, y: -1, ...NO_MODIFIERS});
        expect([...sent, ...before.sent]).toEqual(["\x1b[<0;1;24M", "\x1b[<0;121;1M"]);
    });

    test("focus changes are focus reports, and losing focus forgets held buttons", () => {
        const {encoder: sink, sent} = encoder();
        sink.enqueue({type: "pointerDown", button: PointerButton.Middle, x: 0, y: 0, ...NO_MODIFIERS});
        sink.enqueue({type: "focus", focused: false});
        sink.enqueue({type: "focus", focused: true});
        sink.enqueue({type: "pointerMove", x: 5, y: 5, ...NO_MODIFIERS});
        expect(sent).toEqual(["\x1b[<1;1;1M", "\x1b[O", "\x1b[I", "\x1b[<35;6;6M"]);
    });

    test("terminal input messages carry their bytes and nothing else matches them", () => {
        expect(terminalInputMessage("\x1b[A")).toEqual({type: TERMINAL_INPUT_MESSAGE_TYPE, data: "\x1b[A"});
        expect(isTerminalInputMessage(terminalInputMessage("a"))).toBe(true);
        expect(isTerminalInputMessage({type: TERMINAL_INPUT_MESSAGE_TYPE, data: 1})).toBe(false);
        expect(isTerminalInputMessage({type: "inputEvents", events: []})).toBe(false);
    });
});
