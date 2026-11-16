import {Resource} from "../core/resource";
import type {World} from "../core/world";
import {Input} from "./input";
import type {InputAction} from "./input";
import {Key} from "./key";
import type {PointerButton} from "./pointerButton";

export const INPUT_MAP_RESOURCE_NAME = "InputMap";

export class KeyChord {
    public key: Key = Key.A;
    public ctrl = false;
    public alt = false;
    public shift = false;
    public meta = false;
}

export class InputMapAction {
    public name = "";
    public keys: Key[] = [];
    public chords: KeyChord[] = [];
    public buttons: PointerButton[] = [];
}

export class InputMap extends Resource {
    public actions: InputMapAction[] = [];
}

export interface KeyChordDefinition {
    readonly key: Key;
    readonly ctrl?: boolean;
    readonly alt?: boolean;
    readonly shift?: boolean;
    readonly meta?: boolean;
}

export interface InputActionDefinition {
    readonly keys?: readonly Key[];
    readonly chords?: readonly KeyChordDefinition[];
    readonly buttons?: readonly PointerButton[];
}

export type InputActionNames = Readonly<Record<string, string>>;

export type ResolvedInputActions<T extends InputActionNames> = {readonly [K in keyof T]: InputAction};

const NO_KEYS: readonly Key[] = [];
const NO_CHORDS: readonly KeyChordDefinition[] = [];
const NO_BUTTONS: readonly PointerButton[] = [];

function keyChordOf(definition: KeyChordDefinition): KeyChord {
    const chord = new KeyChord();
    chord.key = definition.key;
    chord.ctrl = definition.ctrl === true;
    chord.alt = definition.alt === true;
    chord.shift = definition.shift === true;
    chord.meta = definition.meta === true;
    return chord;
}

export function inputMapOf(definitions: Readonly<Record<string, InputActionDefinition>>): InputMap {
    const map = new InputMap();
    map.actions = Object.keys(definitions).map(name => {
        const definition = definitions[name];
        const action = new InputMapAction();
        action.name = name;
        action.keys = [...(definition.keys ?? NO_KEYS)];
        action.chords = (definition.chords ?? NO_CHORDS).map(keyChordOf);
        action.buttons = [...(definition.buttons ?? NO_BUTTONS)];
        return action;
    });
    return map;
}

function inputBoundToMap(world: World, names: readonly string[]): Input {
    const map = world.resources.tryGet(InputMap);
    if (map === undefined) {
        throw new Error(`This world has no ${INPUT_MAP_RESOURCE_NAME} resource to resolve the input actions ${names.map(name => JSON.stringify(name)).join(", ")} from: `
            + `list {"type": "${INPUT_MAP_RESOURCE_NAME}", "path": "assets/input.asset.json"} under "resources" in jsengine.project.json, or insert an ${INPUT_MAP_RESOURCE_NAME}`);
    }
    const input = world.resources.getOrCreate(Input);
    input.useInputMap(map);
    return input;
}

export function resolveInputAction(world: World, name: string): InputAction {
    return inputBoundToMap(world, [name]).action(name);
}

export function resolveInputActions<T extends InputActionNames>(world: World, names: T): ResolvedInputActions<T> {
    const input = inputBoundToMap(world, Object.values(names));
    const resolved: Partial<Record<keyof T, InputAction>> = {};
    for (const key of Object.keys(names) as (keyof T & string)[]) resolved[key] = input.action(names[key]);
    return resolved as ResolvedInputActions<T>;
}
