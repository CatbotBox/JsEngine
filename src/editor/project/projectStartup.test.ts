import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {Resource, World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {
    ComponentSchemaRegistry,
    DATA_ASSET_FORMAT,
    DATA_ASSET_VERSION,
    registerEngineComponentSchemas,
    resourceSchema,
    SCENE_DOCUMENT_FORMAT,
    SCENE_DOCUMENT_VERSION,
    sceneEntitiesInCreationOrder,
    SceneManager,
} from "../../engine/scene";
import type {ProjectAssetFiles, ProjectEntryModule, ProjectHost} from "./projectEntry";
import type {ProjectManifest} from "./projectManifest";
import {startProject} from "./projectStartup";

const START_SCENE = "scenes/start.scene.json";
const START_TEXT = JSON.stringify({
    format: SCENE_DOCUMENT_FORMAT,
    version: SCENE_DOCUMENT_VERSION,
    entities: [{id: 1, name: "Start", enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}}],
});
const TUNING_PATH = "data/tuning.asset.json";
const MISSING_PATH = "data/missing.asset.json";
const TUNED_SPEED = 7;
const TUNING_TEXT = JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type: "Tuning", fields: {speed: TUNED_SPEED}});
const MANIFEST_WITHOUT_START_SCENE: ProjectManifest = {name: "demo", entry: "project.ts"};
const MANIFEST_WITH_START_SCENE: ProjectManifest = {...MANIFEST_WITHOUT_START_SCENE, startScene: START_SCENE};
const MANIFEST_WITH_RESOURCES: ProjectManifest = {...MANIFEST_WITH_START_SCENE, resources: [{type: "Tuning", path: TUNING_PATH}]};

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed").build();
    public speed = 1;
}

const NO_ASSET_FILES: ProjectAssetFiles = {
    list: () => [],
    ensureLoaded: () => Promise.resolve(),
    loadFetchingAsNeeded<T>(load: () => T): Promise<T> {
        return Promise.resolve(load());
    },
};

interface Launch {
    readonly world: World;
    readonly host: ProjectHost;
    readonly entry: ProjectEntryModule;
    readonly registry: ComponentSchemaRegistry;
    readonly steps: string[];
}

function launch(): Launch {
    const world = new World({platform: new MemoryPlatform({files: {[START_SCENE]: START_TEXT, [TUNING_PATH]: TUNING_TEXT}})});
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registry.registerResourceClass(Tuning);
    const steps: string[] = [];
    const scenes = new SceneManager(world, registry, {
        preload: async paths => {
            steps.push(`preload ${paths.join(",")}`);
        },
    });
    const host: ProjectHost = {files: NO_ASSET_FILES, renderBackend: "pixels", scenes, quit: () => undefined};
    const entry: ProjectEntryModule = {
        setupProject: setupWorld => {
            const tuning = setupWorld.resources.tryGet(Tuning);
            steps.push(tuning === undefined ? "setup" : `setup with speed ${tuning.speed}`);
            setupWorld.entityManager.createEntity("Systems", [new LocalPosition()]);
        },
    };
    return {world, host, entry, registry, steps};
}

function namesIn(world: World): (string | undefined)[] {
    return sceneEntitiesInCreationOrder(world).map(entity => world.entityManager.nameOf(entity));
}

describe("startProject", () => {
    test("sets the project up, then loads the manifest's start scene as the active scene", async () => {
        const {world, host, entry, registry, steps} = launch();
        const handle = await startProject(world, entry, host, MANIFEST_WITH_START_SCENE, registry);
        expect(steps).toEqual(["setup", `preload ${START_SCENE}`]);
        expect(handle?.path).toBe(START_SCENE);
        expect(host.scenes.active()).toBe(handle);
        expect(namesIn(world)).toEqual(["Systems", "Start"]);
    });

    test("without a start scene it only sets the project up", async () => {
        const {world, host, entry, registry, steps} = launch();
        expect(await startProject(world, entry, host, MANIFEST_WITHOUT_START_SCENE, registry)).toBeUndefined();
        expect(steps).toEqual(["setup"]);
        expect(host.scenes.loaded()).toEqual([]);
        expect(namesIn(world)).toEqual(["Systems"]);
    });

    test("loads the manifest's resources into the world before setup and the start scene", async () => {
        const {world, host, entry, registry, steps} = launch();
        await startProject(world, entry, host, MANIFEST_WITH_RESOURCES, registry);
        expect(steps).toEqual([`preload ${TUNING_PATH}`, `setup with speed ${TUNED_SPEED}`, `preload ${START_SCENE}`]);
        expect(world.resources.get(Tuning).speed).toBe(TUNED_SPEED);
    });

    test("an unregistered resource type crashes before anything loads, naming the type and the path", async () => {
        const {world, host, entry, registry, steps} = launch();
        const manifest: ProjectManifest = {...MANIFEST_WITH_START_SCENE, resources: [{type: "Missing", path: TUNING_PATH}]};
        let failure: unknown;
        await startProject(world, entry, host, manifest, registry).catch(error => failure = error);
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe(`jsengine.project.json resources[0]: the resource type "Missing" for "${TUNING_PATH}" is not registered`);
        expect(steps).toEqual([]);
    });

    test("a missing resource file crashes, naming the path and the type", async () => {
        const {world, host, entry, registry, steps} = launch();
        const manifest: ProjectManifest = {...MANIFEST_WITH_START_SCENE, resources: [{type: "Tuning", path: MISSING_PATH}]};
        let failure: unknown;
        await startProject(world, entry, host, manifest, registry).catch(error => failure = error);
        expect((failure as Error).message)
            .toBe(`jsengine.project.json resources[0]: could not load the Tuning data asset "${MISSING_PATH}": Data asset "${MISSING_PATH}" does not exist`);
        expect(steps).toEqual([`preload ${MISSING_PATH}`]);
        expect(world.resources.tryGet(Tuning)).toBeUndefined();
    });
});
