import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {decodeImageFile} from "../assets/image/decodedImage";
import type {ImageDecoderEntry} from "../assets/image/decodedImage";
import {Component, EntityCommandBufferSystem, Resource, System, World} from "../core";
import {Input, InputMap, Key, NO_MODIFIERS, resolveInputActions} from "../input";
import {INPUT_MAP_SCHEMA_ENTRY} from "../input/schemas";
import {LocalPosition} from "../translation/localPosition";
import {LOCAL_POSITION_SCHEMA_ENTRY} from "../translation/schemas";
import {
    componentSchema,
    DATA_ASSET_FORMAT,
    DATA_ASSET_VERSION,
    resourceSchema,
    SCENE_DOCUMENT_FORMAT,
    SCENE_DOCUMENT_VERSION,
    sceneEntitiesInCreationOrder,
} from "../scene";
import type {SchemaEntry} from "../scene";
import {AssetFiles} from "./assetFiles";
import type {ProjectAssetFiles} from "./assetFiles";
import {startGame} from "./startGame";
import type {GameOptions} from "./startGame";

const DIRECTORY = "games/demo";
const START_SCENE = "scenes/start.scene.json";
const START_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [{id: 1, name: "Start", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}}],
});
const TUNING_PATH = "data/tuning.asset.json";
const MISSING_PATH = "data/missing.asset.json";
const INPUT_PATH = "assets/input.asset.json";
const TUNED_SPEED = 7;
const TUNING_TEXT = JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Tuning", fields: {speed: TUNED_SPEED}});
const INPUT_TEXT = JSON.stringify({
    format: DATA_ASSET_FORMAT,
    version: DATA_ASSET_VERSION,
    type: "InputMap",
    fields: {actions: [{name: "jump", keys: ["Space"], chords: [], buttons: []}]},
});
const JUMP_ACTIONS = {jump: "jump"} as const;
const HOST_SCENE = "scenes/host.scene.json";
const HOST_SCENE_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [{id: 1, name: "Settings", enabled: true, components: {HostSettings: {}, OtherHostSettings: {}}}],
});
const SQUARE_IMAGE_PATH = "images/square.fake";
const SQUARE_IMAGE_SIDE = 2;
const RGBA_BYTES = 4;

class HostSettings extends Component {
}

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed").build();
    public speed = 1;
}

const SCHEMAS: readonly SchemaEntry[] = [LOCAL_POSITION_SCHEMA_ENTRY, {kind: "resourceClass", ctor: Tuning}];
const HOST_SCHEMAS: readonly SchemaEntry[] = [
    {kind: "componentSchema", build: () => componentSchema(HostSettings, "HostSettings").build()},
    {kind: "otherBackendTypes", names: ["OtherHostSettings"]},
];
const SQUARE_DECODER: ImageDecoderEntry = {
    extensions: [".fake"],
    decode: () => ({width: SQUARE_IMAGE_SIDE, height: SQUARE_IMAGE_SIDE, rgba: new Uint8Array(SQUARE_IMAGE_SIDE * SQUARE_IMAGE_SIDE * RGBA_BYTES)}),
};

const NO_ASSET_FILES: ProjectAssetFiles = {
    list: () => [],
    ensureLoaded: () => Promise.resolve(),
    loadFetchingAsNeeded<T>(load: () => T): Promise<T> {
        return Promise.resolve(load());
    },
};

const steps: string[] = [];

class RecordingSystem extends System {
    protected onCreate(): void {
        const tuning = this.world.resources.tryGet(Tuning);
        steps.push(tuning === undefined ? "create" : `create with speed ${tuning.speed}`);
        this.world.entityManager.createEntity("Systems", [new LocalPosition()]);
    }

    public onUpdate(): void {
    }
}

class JumpResolvingSystem extends System {
    protected onCreate(): void {
        const {jump} = resolveInputActions(this.world, JUMP_ACTIONS);
        steps.push(`create resolved ${this.world.resources.get(Input).actionName(jump)}`);
    }

    public onUpdate(): void {
    }
}

function worldWith(files: Readonly<Record<string, string>>): World {
    steps.length = 0;
    return new World({platform: new MemoryPlatform({files})});
}

function projectWorld(): World {
    return worldWith({[START_SCENE]: START_TEXT, [TUNING_PATH]: TUNING_TEXT});
}

function options(extra: Partial<GameOptions> = {}): GameOptions {
    return {
        schemas: SCHEMAS,
        systems: [RecordingSystem],
        preload: async paths => {
            steps.push(`preload ${paths.join(",")}`);
        },
        ...extra,
    };
}

function namesIn(world: World): (string | undefined)[] {
    return sceneEntitiesInCreationOrder(world).map(entity => world.entityManager.nameOf(entity));
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    return "(no error)";
}

describe("startGame", () => {
    test("creates the systems, then loads the start scene as the active scene", async () => {
        const world = projectWorld();
        const game = await startGame(world, options({startScene: START_SCENE}));
        expect(steps).toEqual(["create", `preload ${START_SCENE}`]);
        expect(game.startScene?.path).toBe(START_SCENE);
        expect(game.scenes.active()).toBe(game.startScene);
        expect(namesIn(world)).toEqual(["Systems", "Start"]);
    });

    test("the start scene becomes active on the next command-buffer playback", async () => {
        const world = projectWorld();
        await startGame(world, options({startScene: START_SCENE}));
        const start = sceneEntitiesInCreationOrder(world).find(entity => world.entityManager.nameOf(entity) === "Start")!;
        expect(world.entityManager.isEnabled(start)).toBe(false);
        world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().playback(world.entityManager);
        expect(world.entityManager.isEnabled(start)).toBe(true);
    });

    test("without a start scene it only creates the systems", async () => {
        const world = projectWorld();
        const game = await startGame(world, options());
        expect(game.startScene).toBeUndefined();
        expect(steps).toEqual(["create"]);
        expect(game.scenes.loaded()).toEqual([]);
        expect(namesIn(world)).toEqual(["Systems"]);
    });

    test("loads the resources into the world before the systems and the start scene", async () => {
        const world = projectWorld();
        await startGame(world, options({startScene: START_SCENE, resources: [{type: "Tuning", path: TUNING_PATH}]}));
        expect(steps).toEqual([`preload ${TUNING_PATH}`, `create with speed ${TUNED_SPEED}`, `preload ${START_SCENE}`]);
        expect(world.resources.get(Tuning).speed).toBe(TUNED_SPEED);
    });

    test("reads the project's files from its directory, so engine resources such as the input map resolve while systems are created", async () => {
        const world = worldWith({[`${DIRECTORY}/${INPUT_PATH}`]: INPUT_TEXT});
        await startGame(world, {directory: DIRECTORY, schemas: [INPUT_MAP_SCHEMA_ENTRY], systems: [JumpResolvingSystem], resources: [{type: "InputMap", path: INPUT_PATH}]});
        expect(steps).toEqual(["create resolved jump"]);
        const input = world.resources.get(Input);
        const {jump} = resolveInputActions(world, JUMP_ACTIONS);
        input.enqueue({type: "keyDown", key: Key.Space, repeat: false, ...NO_MODIFIERS});
        world.step();
        expect([input.actionPressed(jump), world.resources.tryGet(InputMap) !== undefined]).toEqual([true, true]);
    });

    test("registers the host's schemas, so a scene skips another backend's type and loads the host's own", async () => {
        const world = worldWith({[HOST_SCENE]: HOST_SCENE_TEXT});
        const game = await startGame(world, options({hostSchemas: HOST_SCHEMAS, startScene: HOST_SCENE}));
        expect(game.registry.byName("HostSettings")).toBeDefined();
        expect(game.registry.byName("OtherHostSettings")).toBeUndefined();
        expect(namesIn(world)).toEqual(["Systems", "Settings"]);
        const settings = sceneEntitiesInCreationOrder(world).find(entity => world.entityManager.nameOf(entity) === "Settings")!;
        expect(world.entityManager.getComponent(settings, HostSettings)).toBeInstanceOf(HostSettings);
    });

    test("registers the image decoders the game lists before anything loads", async () => {
        const world = worldWith({[SQUARE_IMAGE_PATH]: ""});
        expect(() => decodeImageFile(SQUARE_IMAGE_PATH, world.platform)).toThrow("no image decoder is registered for .fake");
        await startGame(world, options({imageDecoders: [SQUARE_DECODER]}));
        expect(decodeImageFile(SQUARE_IMAGE_PATH, world.platform).width).toBe(SQUARE_IMAGE_SIDE);
    });

    test("offers the host's asset files to the game as a resource, and offers none without them", async () => {
        const withFiles = projectWorld();
        await startGame(withFiles, options({files: NO_ASSET_FILES}));
        expect(withFiles.resources.tryGet(AssetFiles)?.files).toBe(NO_ASSET_FILES);
        const withoutFiles = projectWorld();
        await startGame(withoutFiles, options());
        expect(withoutFiles.resources.tryGet(AssetFiles)).toBeUndefined();
    });

    test("an unregistered resource type crashes before anything loads, naming the type and the path", async () => {
        const world = projectWorld();
        const failure = await failureOf(startGame(world, options({startScene: START_SCENE, resources: [{type: "Missing", path: TUNING_PATH}]})));
        expect(failure).toBe(`resources[0]: the resource type "Missing" for "${TUNING_PATH}" is not registered`);
        expect(steps).toEqual([]);
    });

    test("a missing resource file crashes, naming the path and the type", async () => {
        const world = projectWorld();
        const failure = await failureOf(startGame(world, options({startScene: START_SCENE, resources: [{type: "Tuning", path: MISSING_PATH}]})));
        expect(failure).toBe(`resources[0]: could not load the Tuning data asset "${MISSING_PATH}": Data asset "${MISSING_PATH}" does not exist`);
        expect(steps).toEqual([`preload ${MISSING_PATH}`]);
        expect(world.resources.tryGet(Tuning)).toBeUndefined();
    });
});
