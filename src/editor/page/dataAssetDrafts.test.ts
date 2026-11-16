import {describe, expect, test} from "../../engine/testing/harness";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION, parseDataAssetDocument} from "../../engine/scene";
import type {EditorResourceDescription} from "../editorProtocol";
import {
    dataAssetFieldChanges,
    dataAssetPathProblem,
    dataAssetText,
    describeFieldChanges,
    groupDataAssetsByType,
    hasFieldChanges,
    holdsEntityFields,
    isCreatableDataAssetType,
    isDraftDirty,
    openDataAssetDraft,
    savedDraft,
    withDraftField,
} from "./dataAssetDrafts";

const TUNING: EditorResourceDescription = {
    typeName: "Tuning",
    fields: [
        {key: "speed", kind: "number"},
        {key: "spread", kind: "struct", typeName: "Range", fields: [{key: "min", kind: "number"}, {key: "max", kind: "number"}]},
        {key: "waves", kind: "list", element: {kind: "struct", fields: [{key: "count", kind: "integer"}]}, elementDefault: {count: 0}},
    ],
};
const FOCUS: EditorResourceDescription = {typeName: "Focus", fields: [{key: "targets", kind: "list", element: {kind: "entity", nullable: true}, elementDefault: null}]};
const TUNING_DEFAULTS = {speed: 1, spread: {min: 0, max: 1}, waves: []};
const PATH = "assets/tuning.asset.json";

function fileText(type: string, fields: object): string {
    return JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type, fields});
}

describe("data asset drafts", () => {
    test("schema changes list missing and unknown keys, nested ones by path", () => {
        expect(dataAssetFieldChanges(TUNING.fields, {speed: 2, spread: {min: 0, max: 1}, waves: []})).toEqual({addedKeys: [], removedKeys: []});
        expect(dataAssetFieldChanges(TUNING.fields, {speed: 2, old: 1, spread: {min: 0, width: 2}, waves: [{count: 1}, {}]})).toEqual({
            addedKeys: ["spread.max", "waves[1].count"],
            removedKeys: ["old", "spread.width"],
        });
    });

    test("opening a file fills the fields the file lacks from the defaults and drops the unknown ones", () => {
        const draft = openDataAssetDraft(PATH, fileText("Tuning", {speed: 4, retired: true}), TUNING, TUNING_DEFAULTS);
        expect(draft.type).toBe("Tuning");
        expect(draft.fields).toEqual({speed: 4, spread: {min: 0, max: 1}, waves: []});
        expect(draft.changes).toEqual({addedKeys: ["spread", "waves"], removedKeys: ["retired"]});
        expect(hasFieldChanges(draft.changes)).toBe(true);
        expect(isDraftDirty(draft)).toBe(false);
        expect(describeFieldChanges("Tuning", draft.changes)).toBe("This file was written for an older Tuning: new fields spread, waves show their defaults; fields retired are no longer in the schema and are dropped on save.");
    });

    test("a file whose type is not registered keeps its fields as they are", () => {
        const draft = openDataAssetDraft(PATH, fileText("Ghost", {boo: 1}), undefined, {});
        expect([draft.type, draft.fields, hasFieldChanges(draft.changes)]).toEqual(["Ghost", {boo: 1}, false]);
        expect(() => openDataAssetDraft(PATH, "{", TUNING, TUNING_DEFAULTS)).toThrow(`Data asset "${PATH}" is not valid JSON`);
    });

    test("edits make the draft dirty until it is saved, and saving writes the document the engine reads", () => {
        const opened = openDataAssetDraft(PATH, fileText("Tuning", {speed: 4, spread: {min: 0, max: 1}, waves: []}), TUNING, TUNING_DEFAULTS);
        const edited = withDraftField(opened, "speed", 6);
        expect(isDraftDirty(edited)).toBe(true);
        expect(isDraftDirty(withDraftField(edited, "speed", 4))).toBe(false);
        expect(isDraftDirty(savedDraft(edited, edited.fields))).toBe(false);
        expect(isDraftDirty(savedDraft(withDraftField(edited, "speed", 8), edited.fields))).toBe(true);
        const text = dataAssetText(edited.type, edited.fields);
        expect(text.endsWith("}\n")).toBe(true);
        expect(text.split("\n")[1]).toBe(`  "format": "${DATA_ASSET_FORMAT}",`);
        expect(parseDataAssetDocument(text).fields).toEqual({speed: 6, spread: {min: 0, max: 1}, waves: []});
    });

    test("resource types holding entity fields cannot become data assets", () => {
        expect(holdsEntityFields(FOCUS.fields)).toBe(true);
        expect(holdsEntityFields(TUNING.fields)).toBe(false);
        expect(isCreatableDataAssetType(TUNING)).toBe(true);
        expect(isCreatableDataAssetType(FOCUS)).toBe(false);
        expect(isCreatableDataAssetType(undefined)).toBe(false);
    });

    test("new paths must stay in the project, end in .asset.json and not exist yet", () => {
        const existing = new Set([PATH]);
        expect(dataAssetPathProblem("assets/other.asset.json", existing)).toBeUndefined();
        expect(dataAssetPathProblem(`./${PATH}`, existing)).toBe(`${PATH} already exists`);
        expect(dataAssetPathProblem("../outside.asset.json", existing)).toBe("Give a path inside the project folder, such as assets/tuning.asset.json");
        expect(dataAssetPathProblem("assets/tuning.json", existing)).toBe("A data asset file name ends with .asset.json");
    });

    test("listings group by type name, with unreadable files last", () => {
        expect(groupDataAssetsByType([
            {path: "b.asset.json", type: "Tuning"},
            {path: "broken.asset.json", type: undefined},
            {path: "a.asset.json", type: "Tuning"},
            {path: "input.asset.json", type: "InputMap"},
        ])).toEqual([
            {type: "InputMap", paths: ["input.asset.json"]},
            {type: "Tuning", paths: ["a.asset.json", "b.asset.json"]},
            {type: undefined, paths: ["broken.asset.json"]},
        ]);
    });
});
