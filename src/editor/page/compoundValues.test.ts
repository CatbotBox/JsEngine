import {describe, expect, test} from "../../engine/testing/harness";
import {
    canMoveListItem,
    isListItemPath,
    listItemAt,
    listItemPath,
    listLengthOf,
    MOVE_DOWN,
    MOVE_UP,
    NOT_A_LIST,
    sharedListLength,
    structMemberOf,
    structMemberPath,
    withAppendedListItem,
    withListItem,
    withMovedListItem,
    withoutListItem,
    withStructMember,
} from "./compoundValues";

describe("compound field values", () => {
    test("list edits return new arrays and leave the input alone", () => {
        const list = [1, 2, 3];
        expect(withListItem(list, 1, 9)).toEqual([1, 9, 3]);
        expect(withListItem(list, 5, 9)).toEqual([1, 2, 3]);
        expect(withAppendedListItem(list, {x: 0})).toEqual([1, 2, 3, {x: 0}]);
        expect(withoutListItem(list, 0)).toEqual([2, 3]);
        expect(withMovedListItem(list, 0, MOVE_DOWN)).toEqual([2, 1, 3]);
        expect(withMovedListItem(list, 2, MOVE_UP)).toEqual([1, 3, 2]);
        expect(withMovedListItem(list, 0, MOVE_UP)).toEqual([1, 2, 3]);
        expect(list).toEqual([1, 2, 3]);
    });

    test("a value that is not a list reads as an empty one", () => {
        expect(listLengthOf(null)).toBe(NOT_A_LIST);
        expect(listItemAt(null, 0)).toBe(null);
        expect(listItemAt([4], 3)).toBe(null);
        expect(withAppendedListItem("x", 1)).toEqual([1]);
    });

    test("a multi-selection shares a list length only when every list has it", () => {
        expect(sharedListLength([[1, 2], [3, 4]])).toBe(2);
        expect(sharedListLength([[1, 2], [3]])).toBeUndefined();
        expect(sharedListLength([[1], null])).toBeUndefined();
        expect(sharedListLength([])).toBeUndefined();
    });

    test("moves stay inside the list", () => {
        expect(canMoveListItem(3, 0, MOVE_UP)).toBe(false);
        expect(canMoveListItem(3, 0, MOVE_DOWN)).toBe(true);
        expect(canMoveListItem(3, 2, MOVE_DOWN)).toBe(false);
        expect(canMoveListItem(0, 0, MOVE_DOWN)).toBe(false);
    });

    test("struct members read and write by key, keeping the other members", () => {
        const range = {min: 0, max: 1};
        expect(structMemberOf(range, "max")).toBe(1);
        expect(structMemberOf(range, "missing")).toBe(null);
        expect(structMemberOf(null, "min")).toBe(null);
        expect(withStructMember(range, "max", 5)).toEqual({min: 0, max: 5});
        expect(range).toEqual({min: 0, max: 1});
    });

    test("nested paths name list items and struct members", () => {
        const path = structMemberPath(listItemPath("waves", 2), "count");
        expect(path).toBe("waves[2].count");
        expect(isListItemPath(listItemPath("waves", 0))).toBe(true);
        expect(isListItemPath(path)).toBe(false);
    });
});
