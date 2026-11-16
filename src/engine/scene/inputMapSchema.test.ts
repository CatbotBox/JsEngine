import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core/world";
import {Input} from "../input/input";
import {InputMap, InputMapAction, KeyChord, resolveInputActions} from "../input/inputMap";
import {Key} from "../input/key";
import {PointerButton} from "../input/pointerButton";
import {NO_MODIFIERS} from "../input/inputEvent";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION, dataAssetDocumentText, newDataAssetDocument} from "./dataAssetDocument";
import {dataAssetsOf, serializeDataAsset} from "./dataAssets";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import type {SceneFieldValues} from "./sceneDocument";

const INPUT_PATH = "assets/input.asset.json";
const QUIT_ACTIONS = {quit: "quit", look: "look"} as const;

const SAVED_FIELDS: SceneFieldValues = {
    actions: [
        {name: "quit", keys: ["Escape"], chords: [{key: "C", ctrl: true, alt: false, shift: false, meta: false}], buttons: []},
        {name: "look", keys: [], chords: [], buttons: ["Left"]},
    ],
};

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

function assetText(fields: SceneFieldValues): string {
    return dataAssetDocumentText(newDataAssetDocument("InputMap", fields));
}

function worldWithFile(text: string): World {
    return new World({platform: new MemoryPlatform({files: {[INPUT_PATH]: text}})});
}

function loadInputMap(world: World, registry: ComponentSchemaRegistry): InputMap {
    return dataAssetsOf(world, registry).load(INPUT_PATH, InputMap);
}

describe("InputMap data asset", () => {
    test("loads into typed actions and chords, and saves back to the same text", () => {
        const registry = engineRegistry();
        const text = assetText(SAVED_FIELDS);
        const map = loadInputMap(worldWithFile(text), registry);
        const [quit, look] = map.actions;
        expect(quit instanceof InputMapAction && quit.chords[0] instanceof KeyChord).toBe(true);
        expect([quit.name, quit.keys, quit.chords[0].key, quit.chords[0].ctrl, look.buttons]).toEqual(["quit", [Key.Escape], Key.C, true, [PointerButton.Left]]);
        expect(serializeDataAsset(registry, map)).toBe(text);
    });

    test("an action may leave out the bindings it does not use", () => {
        const text = JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "InputMap", fields: {actions: [{name: "jump", keys: ["Space"]}]}});
        const [jump] = loadInputMap(worldWithFile(text), engineRegistry()).actions;
        expect([jump.keys, jump.chords, jump.buttons]).toEqual([[Key.Space], [], []]);
    });

    test("a key name the engine does not know fails the load, naming the field", () => {
        const text = assetText({actions: [{name: "jump", keys: ["Spacebar"], chords: [], buttons: []}]});
        expect(() => loadInputMap(worldWithFile(text), engineRegistry())).toThrow("InputMap.actions[0].keys[0]");
    });

    test("a loaded map drives the world's Input once it is a resource", () => {
        const world = worldWithFile(assetText(SAVED_FIELDS));
        world.resources.insert(loadInputMap(world, engineRegistry()));
        const actions = resolveInputActions(world, QUIT_ACTIONS);
        const input = world.resources.get(Input);
        input.enqueue({type: "keyDown", key: Key.C, repeat: false, ...NO_MODIFIERS, ctrl: true});
        world.step();
        expect(input.actionPressed(actions.quit)).toBe(true);
    });
});
