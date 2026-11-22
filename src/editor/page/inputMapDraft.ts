import {INPUT_MAP_RESOURCE_NAME} from "../../engine/input/inputMap";
import type {Key} from "../../engine/input/key";
import {parseDataAssetDocument} from "../../engine/scene/dataAssetDocument";
import {KEY_FIELD_TYPE, POINTER_BUTTON_FIELD_TYPE} from "../../engine/scene/inputMapSchema";
import {isSceneJsonObject} from "../../engine/scene/sceneDocument";
import type {SceneJsonObject} from "../../engine/scene";
import {dataAssetText} from "./dataAssetDrafts";

export type InputModifier = "ctrl" | "alt" | "shift" | "meta";

export type KeyBinding = {readonly kind: "key", readonly key: string};
export type ChordBinding = {readonly kind: "chord", readonly key: string} & Readonly<Record<InputModifier, boolean>>;
export type ButtonBinding = {readonly kind: "button", readonly button: string};
export type InputBinding = KeyBinding | ChordBinding | ButtonBinding;

export interface InputActionDraft {
    readonly name: string;
    readonly bindings: readonly InputBinding[];
    readonly saved: SceneJsonObject;
}

export interface InputMapDraft {
    readonly fields: SceneJsonObject;
    readonly actions: readonly InputActionDraft[];
}

export type InputMapOpening =
    | {readonly ok: true, readonly draft: InputMapDraft}
    | {readonly ok: false, readonly problems: readonly string[]};

export interface CapturedKey {
    readonly key: Key;
    readonly ctrl: boolean;
    readonly alt: boolean;
    readonly shift: boolean;
    readonly meta: boolean;
}

export const INPUT_MODIFIERS: readonly InputModifier[] = ["ctrl", "alt", "shift", "meta"];
export const INPUT_KEY_NAMES: readonly string[] = KEY_FIELD_TYPE.members.map(member => member.name);
export const INPUT_BUTTON_NAMES: readonly string[] = POINTER_BUTTON_FIELD_TYPE.members.map(member => member.name);
export const NEW_ACTION_NAME = "newAction";
export const EMPTY_INPUT_MAP: InputMapDraft = {fields: {actions: []}, actions: []};

const ACTIONS_KEY = "actions";
const NAME_KEY = "name";
const KEYS_KEY = "keys";
const CHORDS_KEY = "chords";
const BUTTONS_KEY = "buttons";
const CHORD_KEY_KEY = "key";
const MODIFIER_LABELS: Readonly<Record<InputModifier, string>> = {ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta"};
const BUTTON_LABEL_PREFIX = "Mouse ";
const BINDING_SEPARATOR = "+";
const FIRST_DUPLICATE_NUMBER = 2;
const MODIFIER_KEY_NAMES: ReadonlySet<string> = new Set(["Shift", "Ctrl", "Alt", "Meta"]);
const KEY_NAME_BY_VALUE: ReadonlyMap<string | number, string> = new Map(KEY_FIELD_TYPE.members.map(member => [member.value, member.name]));

function stringList(value: unknown): string[] | undefined {
    if (value === undefined) return [];
    return Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : undefined;
}

function chordOf(value: unknown): ChordBinding | undefined {
    if (!isSceneJsonObject(value) || typeof value[CHORD_KEY_KEY] !== "string") return undefined;
    const flags = INPUT_MODIFIERS.map(modifier => value[modifier]);
    if (!flags.every(flag => flag === undefined || typeof flag === "boolean")) return undefined;
    return {kind: "chord", key: value[CHORD_KEY_KEY], ctrl: value.ctrl === true, alt: value.alt === true, shift: value.shift === true, meta: value.meta === true};
}

function actionOf(value: unknown, index: number): {readonly action?: InputActionDraft, readonly problem?: string} {
    const label = `actions[${index}]`;
    if (!isSceneJsonObject(value)) return {problem: `${label} must be an object {"name", "keys", "chords", "buttons"}`};
    const name = value[NAME_KEY];
    if (typeof name !== "string") return {problem: `${label}.name must be a string`};
    const keys = stringList(value[KEYS_KEY]);
    const buttons = stringList(value[BUTTONS_KEY]);
    const chordValues = value[CHORDS_KEY] ?? [];
    const chords = Array.isArray(chordValues) ? chordValues.map(chordOf) : undefined;
    if (keys === undefined) return {problem: `${label}.keys must be a list of key names`};
    if (buttons === undefined) return {problem: `${label}.buttons must be a list of mouse button names`};
    if (chords === undefined || chords.some(chord => chord === undefined)) return {problem: `${label}.chords must be a list of {"key", "ctrl", "alt", "shift", "meta"}`};
    const bindings: InputBinding[] = [
        ...keys.map((key): KeyBinding => ({kind: "key", key})),
        ...chords as ChordBinding[],
        ...buttons.map((button): ButtonBinding => ({kind: "button", button})),
    ];
    return {action: {name, bindings, saved: value}};
}

export function openInputMapDraft(text: string, path?: string): InputMapOpening {
    let fields: SceneJsonObject;
    try {
        const document = parseDataAssetDocument(text, path);
        if (document.type !== INPUT_MAP_RESOURCE_NAME) return {ok: false, problems: [`${path ?? "This file"} holds a ${document.type}, not an ${INPUT_MAP_RESOURCE_NAME}`]};
        fields = document.fields;
    } catch (error) {
        return {ok: false, problems: [error instanceof Error ? error.message : String(error)]};
    }
    const actionValues = fields[ACTIONS_KEY] ?? [];
    if (!Array.isArray(actionValues)) return {ok: false, problems: [`${ACTIONS_KEY} must be a list of actions`]};
    const opened = actionValues.map(actionOf);
    const problems = opened.flatMap(each => each.problem === undefined ? [] : [each.problem]);
    if (problems.length > 0) return {ok: false, problems};
    return {ok: true, draft: {fields, actions: opened.map(each => each.action!)}};
}

function chordValue(chord: ChordBinding): SceneJsonObject {
    return {key: chord.key, ctrl: chord.ctrl, alt: chord.alt, shift: chord.shift, meta: chord.meta};
}

function actionValue(action: InputActionDraft): SceneJsonObject {
    const keys = action.bindings.filter((binding): binding is KeyBinding => binding.kind === "key").map(binding => binding.key);
    const chords = action.bindings.filter((binding): binding is ChordBinding => binding.kind === "chord").map(chordValue);
    const buttons = action.bindings.filter((binding): binding is ButtonBinding => binding.kind === "button").map(binding => binding.button);
    return {...action.saved, [NAME_KEY]: action.name, [KEYS_KEY]: keys, [CHORDS_KEY]: chords, [BUTTONS_KEY]: buttons};
}

export function inputMapText(draft: InputMapDraft): string {
    return dataAssetText(INPUT_MAP_RESOURCE_NAME, {...draft.fields, [ACTIONS_KEY]: draft.actions.map(actionValue)});
}

export function isInputMapDirty(saved: InputMapDraft, draft: InputMapDraft): boolean {
    return inputMapText(saved) !== inputMapText(draft);
}

export function bindingText(binding: InputBinding): string {
    switch (binding.kind) {
        case "key":
            return binding.key;
        case "chord":
            return [...INPUT_MODIFIERS.filter(modifier => binding[modifier]).map(modifier => MODIFIER_LABELS[modifier]), binding.key].join(BINDING_SEPARATOR);
        case "button":
            return BUTTON_LABEL_PREFIX + binding.button;
    }
}

export function sameBinding(a: InputBinding, b: InputBinding): boolean {
    return bindingText(a) === bindingText(b) && a.kind === b.kind;
}

export function isModifierKey(key: Key): boolean {
    const name = KEY_NAME_BY_VALUE.get(key);
    return name !== undefined && MODIFIER_KEY_NAMES.has(name);
}

export function bindingOfCapturedKey(captured: CapturedKey): InputBinding | undefined {
    const key = KEY_NAME_BY_VALUE.get(captured.key);
    if (key === undefined) return undefined;
    const modifiers = INPUT_MODIFIERS.filter(modifier => captured[modifier]);
    if (isModifierKey(captured.key) || modifiers.length === 0) return {kind: "key", key};
    return {kind: "chord", key, ctrl: captured.ctrl, alt: captured.alt, shift: captured.shift, meta: captured.meta};
}

export function uniqueActionName(draft: InputMapDraft, base: string = NEW_ACTION_NAME): string {
    const taken = new Set(draft.actions.map(action => action.name));
    if (!taken.has(base)) return base;
    for (let number = FIRST_DUPLICATE_NUMBER; ; number++) {
        const candidate = `${base}${number}`;
        if (!taken.has(candidate)) return candidate;
    }
}

function withActionAt(draft: InputMapDraft, index: number, change: (action: InputActionDraft) => InputActionDraft): InputMapDraft {
    const action = draft.actions[index];
    if (action === undefined) return draft;
    const actions = [...draft.actions];
    actions[index] = change(action);
    return {...draft, actions};
}

export function withNewAction(draft: InputMapDraft, name: string = uniqueActionName(draft)): InputMapDraft {
    return {...draft, actions: [...draft.actions, {name, bindings: [], saved: {}}]};
}

export function withActionRenamed(draft: InputMapDraft, index: number, name: string): InputMapDraft {
    return withActionAt(draft, index, action => ({...action, name}));
}

export function withoutAction(draft: InputMapDraft, index: number): InputMapDraft {
    if (draft.actions[index] === undefined) return draft;
    return {...draft, actions: draft.actions.filter((_action, each) => each !== index)};
}

export function withActionMoved(draft: InputMapDraft, index: number, offset: number): InputMapDraft {
    const target = index + offset;
    if (draft.actions[index] === undefined || draft.actions[target] === undefined) return draft;
    const actions = [...draft.actions];
    [actions[index], actions[target]] = [actions[target], actions[index]];
    return {...draft, actions};
}

export function withBinding(draft: InputMapDraft, index: number, binding: InputBinding): InputMapDraft {
    const action = draft.actions[index];
    if (action === undefined || action.bindings.some(existing => sameBinding(existing, binding))) return draft;
    return withActionAt(draft, index, current => ({...current, bindings: [...current.bindings, binding]}));
}

export function withoutBinding(draft: InputMapDraft, index: number, bindingIndex: number): InputMapDraft {
    return withActionAt(draft, index, action => ({...action, bindings: action.bindings.filter((_binding, each) => each !== bindingIndex)}));
}

function bindingProblem(binding: InputBinding): string | undefined {
    if (binding.kind === "button") return INPUT_BUTTON_NAMES.includes(binding.button) ? undefined : `"${binding.button}" is not a mouse button (${INPUT_BUTTON_NAMES.join(", ")}); remove it`;
    return INPUT_KEY_NAMES.includes(binding.key) ? undefined : `"${binding.key}" is not a key name; remove ${bindingText(binding)}`;
}

export function inputMapProblems(draft: InputMapDraft): ReadonlyMap<number, readonly string[]> {
    const byAction = new Map<number, string[]>();
    const add = (index: number, problem: string): void => {
        const listed = byAction.get(index);
        if (listed === undefined) byAction.set(index, [problem]);
        else listed.push(problem);
    };
    const firstIndexByName = new Map<string, number>();
    draft.actions.forEach((action, index) => {
        const name = action.name;
        if (name.trim().length === 0) add(index, "The action needs a name; code looks actions up by it");
        else if (name !== name.trim()) add(index, `"${name}" has spaces around it, so code asking for "${name.trim()}" would not find it`);
        const first = firstIndexByName.get(name);
        if (first === undefined) firstIndexByName.set(name, index);
        else if (name.trim().length > 0) add(index, `"${name}" is already the name of action ${first + 1}; action names must be unique`);
        for (const binding of action.bindings) {
            const problem = bindingProblem(binding);
            if (problem !== undefined) add(index, problem);
        }
    });
    return byAction;
}
