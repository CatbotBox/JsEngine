import {describe, expect, test} from "../../engine/testing/harness";
import {keyEventsOfChord, mouseEventOfHover, mouseEventsOfClick, mouseEventsOfDrag} from "./smokeInput";

describe("keyEventsOfChord", () => {
    test("a shortcut presses its modifiers with the key and types nothing", () => {
        expect(keyEventsOfChord("Ctrl+Shift+P")).toEqual([
            {type: "keyDown", keyCode: "p", modifiers: ["control", "shift"]},
            {type: "keyUp", keyCode: "p", modifiers: ["control", "shift"]},
        ]);
    });

    test("a letter is sent lower case, since Electron reads an upper-case key code as Shift held", () => {
        expect(keyEventsOfChord("Ctrl+Z").map(event => event.keyCode)).toEqual(["z", "z"]);
    });

    test("a printable key without Ctrl, Alt or Meta also types its character", () => {
        expect(keyEventsOfChord("W").map(event => event.type)).toEqual(["keyDown", "char", "keyUp"]);
        expect(keyEventsOfChord("Shift+W").map(event => event.type)).toEqual(["keyDown", "char", "keyUp"]);
        expect(keyEventsOfChord("Alt+W").map(event => event.type)).toEqual(["keyDown", "keyUp"]);
    });

    test("named keys pass through, and DOM arrow names become Electron's", () => {
        expect(keyEventsOfChord("Escape").map(event => [event.type, event.keyCode])).toEqual([["keyDown", "Escape"], ["keyUp", "Escape"]]);
        expect(keyEventsOfChord("ArrowUp")[0].keyCode).toBe("Up");
        expect(keyEventsOfChord("Shift+ArrowLeft")[0]).toEqual({type: "keyDown", keyCode: "Left", modifiers: ["shift"]});
    });

    test("an unknown modifier or a missing key is refused", () => {
        expect(() => keyEventsOfChord("Hyper+K")).toThrow("\"Hyper\" in \"Hyper+K\" is not a modifier");
        expect(() => keyEventsOfChord("Ctrl+")).toThrow("names no key");
    });
});

describe("mouse events", () => {
    test("a click moves to the rounded point, then presses and releases there once", () => {
        expect(mouseEventsOfClick(10.4, 20.6, "right")).toEqual([
            {type: "mouseMove", x: 10, y: 21, button: "right", clickCount: 0, modifiers: []},
            {type: "mouseDown", x: 10, y: 21, button: "right", clickCount: 1, modifiers: []},
            {type: "mouseUp", x: 10, y: 21, button: "right", clickCount: 1, modifiers: []},
        ]);
    });

    test("a hover only moves", () => {
        expect(mouseEventOfHover(3.5, 4.2)).toEqual({type: "mouseMove", x: 4, y: 4, button: "left", clickCount: 0, modifiers: []});
    });

    test("a drag presses at the start, moves in steps with the left button held, and releases at the end", () => {
        const events = mouseEventsOfDrag(10, 20, 90, 60);
        expect(events.map(event => event.type)).toEqual(["mouseMove", "mouseDown", ...Array.from({length: 8}, () => "mouseMove"), "mouseUp"]);
        expect(events[1]).toEqual({type: "mouseDown", x: 10, y: 20, button: "left", clickCount: 1, modifiers: []});
        expect(events[2]).toEqual({type: "mouseMove", x: 20, y: 25, button: "left", clickCount: 0, modifiers: ["leftbuttondown"]});
        expect(events[events.length - 2]).toEqual({type: "mouseMove", x: 90, y: 60, button: "left", clickCount: 0, modifiers: ["leftbuttondown"]});
        expect(events[events.length - 1]).toEqual({type: "mouseUp", x: 90, y: 60, button: "left", clickCount: 1, modifiers: []});
    });
});
