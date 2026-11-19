import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import {Input, InputMap, Key, NO_MODIFIERS, resolveInputActions} from "../input";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "../scene";
import type {ProjectEntryModule, ProjectHost} from "./projectEntry";
import {launchProject} from "./projectLaunch";
import {PROJECT_MANIFEST_FILE} from "./projectManifest";

const DIRECTORY = "games/demo";
const INPUT_PATH = "assets/input.asset.json";
const JUMP_ACTIONS = {jump: "jump"} as const;
const MANIFEST_TEXT = JSON.stringify({name: "Demo", entry: "project.ts", resources: [{type: "InputMap", path: INPUT_PATH}]});
const INPUT_TEXT = JSON.stringify({
    format: DATA_ASSET_FORMAT,
    version: DATA_ASSET_VERSION,
    type: "InputMap",
    fields: {actions: [{name: "jump", keys: ["Space"], chords: [], buttons: []}]},
});

interface Observed {
    readonly steps: string[];
    host?: ProjectHost;
}

function worldWith(files: Readonly<Record<string, string>>): World {
    return new World({platform: new MemoryPlatform({files})});
}

function recordingEntry(observed: Observed): ProjectEntryModule {
    return {
        setupProject: (world, host) => {
            observed.host = host;
            const {jump} = resolveInputActions(world, JUMP_ACTIONS);
            observed.steps.push(`setup resolved ${world.resources.get(Input).actionName(jump)}`);
        },
    };
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    return "(no error)";
}

describe("launchProject", () => {
    test("loads the manifest and its resources from the project folder through the preload, then runs the setup", async () => {
        const world = worldWith({[`${DIRECTORY}/${PROJECT_MANIFEST_FILE}`]: MANIFEST_TEXT, [`${DIRECTORY}/${INPUT_PATH}`]: INPUT_TEXT});
        const observed: Observed = {steps: []};
        const launched = await launchProject(world, {
            directory: DIRECTORY,
            entry: recordingEntry(observed),
            preload: async paths => {
                observed.steps.push(`preload ${paths.join(",")}`);
            },
        });
        expect(observed.steps).toEqual([`preload ${PROJECT_MANIFEST_FILE}`, `preload ${INPUT_PATH}`, "setup resolved jump"]);
        expect(launched.manifest.name).toBe("Demo");
        expect(launched.startScene).toBeUndefined();
        expect(observed.host).toBe(launched.host);

        const input = world.resources.get(Input);
        const {jump} = resolveInputActions(world, JUMP_ACTIONS);
        input.enqueue({type: "keyDown", key: Key.Space, repeat: false, ...NO_MODIFIERS});
        world.step();
        expect([input.actionPressed(jump), world.resources.tryGet(InputMap) !== undefined]).toEqual([true, true]);
    });

    test("a missing manifest or a missing resource file stops the launch, naming the path", async () => {
        const entry = recordingEntry({steps: []});
        const launchIn = (world: World) => launchProject(world, {directory: DIRECTORY, entry});
        expect(await failureOf(launchIn(worldWith({})))).toBe(`${DIRECTORY}/${PROJECT_MANIFEST_FILE} does not exist: launch the project from the folder that holds its manifest`);
        expect(await failureOf(launchIn(worldWith({[`${DIRECTORY}/${PROJECT_MANIFEST_FILE}`]: MANIFEST_TEXT}))))
            .toBe(`${PROJECT_MANIFEST_FILE} resources[0]: could not load the InputMap data asset "${INPUT_PATH}": Data asset "${INPUT_PATH}" does not exist`);
        expect(await failureOf(launchIn(worldWith({[`${DIRECTORY}/${PROJECT_MANIFEST_FILE}`]: "{\"entry\": \"project.ts\"}"}))))
            .toBe(`${DIRECTORY}/${PROJECT_MANIFEST_FILE}: "name" is missing: give the project a name`);
    });
});
