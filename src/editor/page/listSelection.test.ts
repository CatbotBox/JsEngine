import {describe, expect, test} from "../../engine/testing/harness";
import {clickedSelection, emptyListSelection, PLAIN_CLICK, retainedSelection, selectionModifiersOf} from "./listSelection";
import type {ListSelection} from "./listSelection";

const ROWS = ["a", "b", "c", "d", "e"];
const TOGGLE = {toggle: true, extend: false};
const EXTEND = {toggle: false, extend: true};
const TOGGLE_EXTEND = {toggle: true, extend: true};

function click(current: ListSelection<string>, clicked: string, modifiers = PLAIN_CLICK): ListSelection<string> {
    return clickedSelection(ROWS, current, clicked, modifiers);
}

describe("list selection", () => {
    test("a plain click selects only the clicked row and anchors there", () => {
        expect(click({selected: ["a", "c"], anchor: "a"}, "d")).toEqual({selected: ["d"], anchor: "d"});
    });

    test("Ctrl toggles the clicked row and moves the anchor", () => {
        const added = click({selected: ["a"], anchor: "a"}, "c", TOGGLE);
        expect(added).toEqual({selected: ["a", "c"], anchor: "c"});
        expect(click(added, "a", TOGGLE)).toEqual({selected: ["c"], anchor: "a"});
    });

    test("Shift selects the range from the anchor in click order, keeping the anchor", () => {
        expect(click({selected: ["b"], anchor: "b"}, "d", EXTEND)).toEqual({selected: ["b", "c", "d"], anchor: "b"});
        expect(click({selected: ["d"], anchor: "d"}, "b", EXTEND)).toEqual({selected: ["d", "c", "b"], anchor: "d"});
    });

    test("Ctrl+Shift adds the range to the selection", () => {
        expect(click({selected: ["a", "e"], anchor: "c"}, "d", TOGGLE_EXTEND)).toEqual({selected: ["a", "e", "c", "d"], anchor: "c"});
    });

    test("Shift without a visible anchor acts as a plain click", () => {
        expect(click(emptyListSelection(), "c", EXTEND)).toEqual({selected: ["c"], anchor: "c"});
        expect(click({selected: ["z"], anchor: "z"}, "c", EXTEND)).toEqual({selected: ["c"], anchor: "c"});
    });

    test("event modifiers map Ctrl or Cmd to toggle and Shift to extend", () => {
        expect(selectionModifiersOf({ctrlKey: false, metaKey: true, shiftKey: false})).toEqual(TOGGLE);
        expect(selectionModifiersOf({ctrlKey: true, metaKey: false, shiftKey: true})).toEqual(TOGGLE_EXTEND);
    });

    test("retaining drops rows that are gone, and keeps the same selection when nothing changed", () => {
        const current = {selected: ["a", "b", "c"], anchor: "b"};
        expect(retainedSelection(current, row => row !== "b")).toEqual({selected: ["a", "c"], anchor: undefined});
        expect(retainedSelection(current, () => true)).toBe(current);
    });
});
