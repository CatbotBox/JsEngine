import {describe, expect, test} from "../../engine/testing/harness";
import {Key} from "../../engine/input/key";
import {parseDataAssetDocument} from "../../engine/scene/dataAssetDocument";
import {
    bindingOfCapturedKey,
    bindingText,
    EMPTY_INPUT_MAP,
    INPUT_BUTTON_NAMES,
    INPUT_KEY_NAMES,
    inputMapProblems,
    inputMapText,
    isInputMapDirty,
    isModifierKey,
    NEW_ACTION_NAME,
    openInputMapDraft,
    uniqueActionName,
    withActionMoved,
    withActionRenamed,
    withBinding,
    withNewAction,
    withoutAction,
    withoutBinding,
} from "./inputMapDraft";
import type {InputMapDraft} from "./inputMapDraft";

const INPUT_ASSET = `{
  "format": "jsengine-asset",
  "version": 1,
  "type": "InputMap",
  "fields": {
    "actions": [
      {
        "name": "moveUp",
        "keys": [
          "W",
          "Up"
        ],
        "chords": [],
        "buttons": []
      },
      {
        "name": "quit",
        "keys": [
          "Escape"
        ],
        "chords": [
          {
            "key": "C",
            "ctrl": true,
            "alt": false,
            "shift": false,
            "meta": false
          }
        ],
        "buttons": [
          "Right"
        ],
        "deadZone": 0.25
      }
    ]
  }
}
`;
const NO_MODIFIERS = {ctrl: false, alt: false, shift: false, meta: false};

function opened(text: string = INPUT_ASSET): InputMapDraft {
    const opening = openInputMapDraft(text);
    if (!opening.ok) throw new Error(opening.problems.join("; "));
    return opening.draft;
}

function actionsOf(draft: InputMapDraft): unknown {
    return parseDataAssetDocument(inputMapText(draft)).fields.actions;
}

describe("input map drafts", () => {
    test("an untouched input map writes back byte for byte, unknown action fields included", () => {
        const draft = opened();
        expect(inputMapText(draft)).toBe(INPUT_ASSET);
        expect(isInputMapDirty(draft, draft)).toBe(false);
    });

    test("bindings read keys, then chords, then mouse buttons, and print the way the Input Map shows them", () => {
        const quit = opened().actions[1];
        expect(quit.name).toBe("quit");
        expect(quit.bindings.map(bindingText)).toEqual(["Escape", "Ctrl+C", "Mouse Right"]);
    });

    test("adding, renaming, moving and removing actions writes the asset the engine loads", () => {
        let draft = withNewAction(opened());
        expect(draft.actions[2].name).toBe(NEW_ACTION_NAME);
        expect(uniqueActionName(draft)).toBe(`${NEW_ACTION_NAME}2`);
        draft = withActionRenamed(draft, 2, "fire");
        draft = withBinding(draft, 2, {kind: "key", key: "Space"});
        draft = withBinding(draft, 2, {kind: "button", button: "Left"});
        draft = withActionMoved(draft, 2, -1);
        expect(draft.actions.map(action => action.name)).toEqual(["moveUp", "fire", "quit"]);
        expect(actionsOf(draft)).toEqual([
            {name: "moveUp", keys: ["W", "Up"], chords: [], buttons: []},
            {name: "fire", keys: ["Space"], chords: [], buttons: ["Left"]},
            {name: "quit", keys: ["Escape"], chords: [{key: "C", ctrl: true, alt: false, shift: false, meta: false}], buttons: ["Right"], deadZone: 0.25},
        ]);
        draft = withoutAction(draft, 0);
        expect(draft.actions.map(action => action.name)).toEqual(["fire", "quit"]);
        expect(isInputMapDirty(opened(), draft)).toBe(true);
    });

    test("removing a binding keeps the others in order, and a binding the action already has is not added twice", () => {
        let draft = withoutBinding(opened(), 1, 1);
        expect(draft.actions[1].bindings.map(bindingText)).toEqual(["Escape", "Mouse Right"]);
        draft = withBinding(draft, 1, {kind: "key", key: "Escape"});
        expect(draft.actions[1].bindings.length).toBe(2);
        draft = withBinding(draft, 1, {kind: "chord", key: "Q", ...NO_MODIFIERS, ctrl: true});
        expect(actionsOf(draft)).toEqual([
            {name: "moveUp", keys: ["W", "Up"], chords: [], buttons: []},
            {name: "quit", keys: ["Escape"], chords: [{key: "Q", ctrl: true, alt: false, shift: false, meta: false}], buttons: ["Right"], deadZone: 0.25},
        ]);
    });

    test("moves and edits past either end leave the draft alone", () => {
        const draft = opened();
        expect(withActionMoved(draft, 0, -1)).toBe(draft);
        expect(withActionMoved(draft, 1, 1)).toBe(draft);
        expect(withoutAction(draft, 5)).toBe(draft);
        expect(withBinding(draft, 5, {kind: "key", key: "A"})).toBe(draft);
    });

    test("a captured key becomes a key binding, with modifiers a chord, and a modifier key alone a key", () => {
        expect(bindingOfCapturedKey({key: Key.W, ...NO_MODIFIERS})).toEqual({kind: "key", key: "W"});
        expect(bindingOfCapturedKey({key: Key.Enter, ...NO_MODIFIERS})).toEqual({kind: "key", key: "Enter"});
        expect(bindingOfCapturedKey({key: Key.S, ...NO_MODIFIERS, ctrl: true, shift: true})).toEqual({kind: "chord", key: "S", ctrl: true, alt: false, shift: true, meta: false});
        expect(bindingOfCapturedKey({key: Key.Shift, ...NO_MODIFIERS, shift: true})).toEqual({kind: "key", key: "Shift"});
        expect([Key.Shift, Key.Ctrl, Key.Alt, Key.Meta, Key.W].map(isModifierKey)).toEqual([true, true, true, true, false]);
    });

    test("empty, padded and repeated action names and unknown keys or buttons are problems of their action", () => {
        let draft = withNewAction(withNewAction(EMPTY_INPUT_MAP, ""), " jump ");
        draft = withNewAction(draft, "fire");
        draft = withNewAction(draft, "fire");
        draft = withBinding(draft, 2, {kind: "key", key: "Hyper"});
        draft = withBinding(draft, 2, {kind: "button", button: "Back"});
        const problems = inputMapProblems(draft);
        expect([...problems.keys()]).toEqual([0, 1, 2, 3]);
        expect(problems.get(0)?.[0]).toBe("The action needs a name; code looks actions up by it");
        expect(problems.get(1)?.[0].startsWith(`" jump " has spaces around it`)).toBe(true);
        expect(problems.get(2)?.length).toBe(2);
        expect(problems.get(3)?.[0]).toBe(`"fire" is already the name of action 3; action names must be unique`);
        expect(inputMapProblems(opened()).size).toBe(0);
    });

    test("the key and button names are the engine's enum member names", () => {
        expect(INPUT_KEY_NAMES.includes("Escape") && INPUT_KEY_NAMES.includes("Num1") && INPUT_KEY_NAMES.includes("F12")).toBe(true);
        expect(INPUT_KEY_NAMES.includes("escape")).toBe(false);
        expect(INPUT_BUTTON_NAMES).toEqual(["Left", "Middle", "Right"]);
    });

    test("files that are not an input map, or hold malformed actions, do not open", () => {
        const tuning = INPUT_ASSET.replace("\"InputMap\"", "\"SwarmTuning\"");
        expect(openInputMapDraft(tuning, "assets/tuning.asset.json")).toEqual({ok: false, problems: ["assets/tuning.asset.json holds a SwarmTuning, not an InputMap"]});
        expect(openInputMapDraft("nope").ok).toBe(false);
        const badKeys = INPUT_ASSET.replace("\"W\",", "3,");
        expect(openInputMapDraft(badKeys)).toEqual({ok: false, problems: ["actions[0].keys must be a list of key names"]});
        const empty = openInputMapDraft("{\"format\": \"jsengine-asset\", \"version\": 1, \"type\": \"InputMap\", \"fields\": {}}");
        expect(empty.ok && empty.draft.actions.length === 0).toBe(true);
    });
});
