import {describe, expect, test} from "../../engine/testing/harness";
import type {EditorFieldTypeDescription} from "../editorProtocol";
import {FieldDrawerRegistry, fieldTypeNameOf} from "./fieldDrawers";
import type {FieldDrawerFactory} from "./fieldDrawers";

const CURVE_DRAWER: FieldDrawerFactory = () => {
    throw new Error("not drawn in this test");
};
const PERCENT_DRAWER: FieldDrawerFactory = () => {
    throw new Error("not drawn in this test");
};

const CURVE_FIELD: EditorFieldTypeDescription = {kind: "custom", typeName: "Curve"};
const PERCENT_FIELD: EditorFieldTypeDescription = {kind: "number", typeName: "Percent", options: {min: 0, max: 1}};
const RANGE_FIELD: EditorFieldTypeDescription = {kind: "struct", typeName: "Range", fields: []};
const PLAIN_NUMBER: EditorFieldTypeDescription = {kind: "number"};

describe("field drawers", () => {
    test("a drawer is found for any field kind carrying its type name", () => {
        const drawers = new FieldDrawerRegistry();
        drawers.register("Curve", CURVE_DRAWER);
        drawers.register("Percent", PERCENT_DRAWER);
        expect(drawers.drawerFor(CURVE_FIELD)).toBe(CURVE_DRAWER);
        expect(drawers.drawerFor(PERCENT_FIELD)).toBe(PERCENT_DRAWER);
        expect(drawers.drawerFor(RANGE_FIELD)).toBeUndefined();
        expect(drawers.drawerFor(PLAIN_NUMBER)).toBeUndefined();
        expect([fieldTypeNameOf(RANGE_FIELD), fieldTypeNameOf(PLAIN_NUMBER)]).toEqual(["Range", undefined]);
    });

    test("a type name takes one drawer until it is unregistered, which reloading extensions relies on", () => {
        const drawers = new FieldDrawerRegistry();
        const unregister = drawers.register("Curve", CURVE_DRAWER);
        expect(() => drawers.register("Curve", PERCENT_DRAWER)).toThrow(`A field drawer for "Curve" is already registered`);
        expect(() => drawers.register("", CURVE_DRAWER)).toThrow("non-empty type name");
        unregister();
        expect(drawers.size).toBe(0);
        const replaced = drawers.register("Curve", PERCENT_DRAWER);
        unregister();
        expect(drawers.drawerFor(CURVE_FIELD)).toBe(PERCENT_DRAWER);
        replaced();
        expect(drawers.drawerFor(CURVE_FIELD)).toBeUndefined();
    });
});
