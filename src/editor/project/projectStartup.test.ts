import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {
    ComponentSchemaRegistry,
    registerEngineComponentSchemas,
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
const MANIFEST_WITHOUT_START_SCENE: ProjectManifest = {name: "demo", entry: "project.ts"};
const MANIFEST_WITH_START_SCENE: ProjectManifest = {...MANIFEST_WITHOUT_START_SCENE, startScene: START_SCENE};

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
    readonly steps: string[];
}

function launch(): Launch {
    const world = new World({platform: new MemoryPlatform({files: {[START_SCENE]: START_TEXT}})});
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    const steps: string[] = [];
    const scenes = new SceneManager(world, registry, {
        preload: async paths => {
            steps.push(`preload ${paths.join(",")}`);
        },
    });
    const host: ProjectHost = {files: NO_ASSET_FILES, renderBackend: "pixels", scenes, quit: () => undefined};
    const entry: ProjectEntryModule = {
        registerProjectSchemas: () => undefined,
        setupProject: setupWorld => {
            steps.push("setup");
            setupWorld.entityManager.createEntity("Systems", [new LocalPosition()]);
        },
    };
    return {world, host, entry, steps};
}

function namesIn(world: World): (string | undefined)[] {
    return sceneEntitiesInCreationOrder(world).map(entity => world.entityManager.nameOf(entity));
}

describe("startProject", () => {
    test("sets the project up, then loads the manifest's start scene as the active scene", async () => {
        const {world, host, entry, steps} = launch();
        const handle = await startProject(world, entry, host, MANIFEST_WITH_START_SCENE);
        expect(steps).toEqual(["setup", `preload ${START_SCENE}`]);
        expect(handle?.path).toBe(START_SCENE);
        expect(host.scenes.active()).toBe(handle);
        expect(namesIn(world)).toEqual(["Systems", "Start"]);
    });

    test("without a start scene it only sets the project up", async () => {
        const {world, host, entry, steps} = launch();
        expect(await startProject(world, entry, host, MANIFEST_WITHOUT_START_SCENE)).toBeUndefined();
        expect(steps).toEqual(["setup"]);
        expect(host.scenes.loaded()).toEqual([]);
        expect(namesIn(world)).toEqual(["Systems"]);
    });
});
