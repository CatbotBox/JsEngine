import {describe, expect, test} from "../testing/harness";
import {registerBuiltinImageDecoders} from "../assets/image/builtinDecoders";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {NULL_ENTITY, Resource, World} from "../core";
import type {Entity} from "../core";
import {Vec} from "../math/types/vec";
import {LocalPosition} from "../translation/localPosition";
import {Camera} from "../rendering/camera";
import {SpriteImage} from "../rendering/2d/spriteImage";
import {encodePpm} from "../assets/image/ppm";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {resourceSchema} from "./componentSchemaBuilder";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {platformSceneAssetLoader, sceneAssetPaths} from "./sceneAssets";
import {parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneDocument} from "./sceneDocument";
import {applySceneInPlace, deserializeInto, serializeWorld} from "./sceneSerialization";

const BACKDROP_PATH = "sprites/backdrop.ppm";
const SAVED_WAVE = 7;
const CHANGED_WAVE = 9;
const OLD_NEAR_PLANE = 0.25;
const DEFAULT_FAR_PLANE = new Camera().farPlaneDistance;

class Scoreboard extends Resource {
    public static readonly schema = resourceSchema(Scoreboard, "Scoreboard").integer("wave").string("title").build();
    public wave = 1;
    public title = "swarm";
}

class Focus extends Resource {
    public static readonly schema = resourceSchema(Focus, "Focus").entity("target").build();
    public target: Entity = NULL_ENTITY;
}

class Backdrop extends Resource {
    public static readonly schema = resourceSchema(Backdrop, "Backdrop").spriteImage("image").build();
    public image: SpriteImage | undefined = undefined;
}

class Unsaved extends Resource {
    public count = 0;
}

function platform(): MemoryPlatform {
    return new MemoryPlatform({files: {[BACKDROP_PATH]: encodePpm(1, 1, new Uint8Array([1, 2, 3, 255]))}});
}

function registry(): ComponentSchemaRegistry {
    const result = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(result);
    result.registerResourceClasses([Scoreboard, Focus, Backdrop]);
    return result;
}

function document(entities: SceneDocument["entities"], resources?: SceneDocument["resources"]): SceneDocument {
    const result: SceneDocument = {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities};
    if (resources !== undefined) result.resources = resources;
    return result;
}

registerBuiltinImageDecoders();

describe("scene resources", () => {
    test("registered resources that exist are saved with entity references as scene ids; absent and unregistered ones are not", () => {
        const world = new World({platform: platform()});
        const target = world.entityManager.createEntity("target", [new LocalPosition()]);
        world.resources.getOrCreate(Scoreboard).wave = SAVED_WAVE;
        world.resources.getOrCreate(Focus).target = target;
        world.resources.getOrCreate(Unsaved).count = 4;
        const saved = serializeWorld(world, registry()).document;
        expect(saved.resources).toEqual({Scoreboard: {wave: SAVED_WAVE, title: "swarm"}, Focus: {target: 1}});
        expect(serializeWorld(new World({platform: platform()}), registry()).document.resources).toBeUndefined();
    });

    test("loading creates or reuses each resource, assigns its fields and remaps entity references", () => {
        const source = new World({platform: platform()});
        const target = source.entityManager.createEntity("target", [new LocalPosition(1, 2, 3)]);
        source.resources.getOrCreate(Scoreboard).wave = SAVED_WAVE;
        source.resources.getOrCreate(Focus).target = target;
        const text = JSON.stringify(serializeWorld(source, registry()).document);

        const loadedWorld = new World({platform: platform()});
        const existing = loadedWorld.resources.getOrCreate(Scoreboard);
        const loaded = deserializeInto(loadedWorld, registry(), parseSceneDocument(text));
        expect(loadedWorld.resources.get(Scoreboard)).toBe(existing);
        expect(existing.wave).toBe(SAVED_WAVE);
        expect(loadedWorld.resources.get(Focus).target).toBe(loaded.entities[0]);
        expect(serializeWorld(loadedWorld, registry()).document).toEqual(parseSceneDocument(text));
    });

    test("applySceneInPlace restores resource fields", () => {
        const world = new World({platform: platform()});
        world.resources.getOrCreate(Scoreboard).wave = SAVED_WAVE;
        const snapshot = serializeWorld(world, registry());
        world.resources.get(Scoreboard).wave = CHANGED_WAVE;
        world.resources.get(Scoreboard).title = "changed";
        applySceneInPlace(world, registry(), snapshot);
        expect(world.resources.get(Scoreboard).wave).toBe(SAVED_WAVE);
        expect(world.resources.get(Scoreboard).title).toBe("swarm");
    });

    test("unknown resource types throw, or are skipped and reported", () => {
        const scene = document([], {Mystery: {value: 1}, Scoreboard: {wave: CHANGED_WAVE}});
        expect(() => deserializeInto(new World({platform: platform()}), registry(), scene))
            .toThrow(`Scene document: resources.Mystery: the resource type "Mystery" is not registered`);
        const world = new World({platform: platform()});
        const loaded = deserializeInto(world, registry(), scene, {unknownComponentTypes: "skip"});
        expect(loaded.report.skippedResourceTypes).toEqual(["Mystery"]);
        expect(world.resources.get(Scoreboard).wave).toBe(CHANGED_WAVE);
    });

    test("resource asset paths are listed for preloading and load through the asset loader", () => {
        const files = platform();
        const scene = document([], {Backdrop: {image: {path: BACKDROP_PATH}}});
        expect(sceneAssetPaths(scene, registry())).toEqual([{kind: "spriteImage", path: BACKDROP_PATH}]);
        const world = new World({platform: files});
        deserializeInto(world, registry(), scene, {assets: platformSceneAssetLoader(files)});
        expect(world.resources.get(Backdrop).image?.sourcePath).toBe(BACKDROP_PATH);
    });
});

describe("schema changes on load", () => {
    const changed = () => document([
        {id: 1, name: "moved", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3], wobble: 4}}},
        {id: 2, name: "lens", enabled: true, components: {Camera: {nearPlaneDistance: OLD_NEAR_PLANE}}},
    ], {Scoreboard: {wave: SAVED_WAVE, retired: true}});

    test("strict loading still throws on a field the schema no longer has", () => {
        expect(() => deserializeInto(new World({platform: platform()}), registry(), changed()))
            .toThrow(`Scene document: entities[0].components.LocalPosition: LocalPosition has no field "wobble"`);
    });

    test("reporting keeps defaults for new fields, drops removed ones and lists both per type", () => {
        const world = new World({platform: platform()});
        const loaded = deserializeInto(world, registry(), changed(), {schemaChanges: "report"});
        expect(loaded.report.changedSchemas).toEqual([
            {typeName: "Camera", addedKeys: ["farPlaneDistance"], removedKeys: []},
            {typeName: "LocalPosition", addedKeys: [], removedKeys: ["wobble"]},
            {typeName: "Scoreboard", addedKeys: ["title"], removedKeys: ["retired"]},
        ]);
        const position = world.entityManager.getComponent<LocalPosition>(loaded.entities[0], LocalPosition)!;
        expect(Vec.toArray(position.xyz)).toEqual([1, 2, 3]);
        const camera = world.entityManager.getComponent<Camera>(loaded.entities[1], Camera)!;
        expect([camera.nearPlaneDistance, camera.farPlaneDistance]).toEqual([OLD_NEAR_PLANE, DEFAULT_FAR_PLANE]);
        expect(world.resources.get(Scoreboard).title).toBe("swarm");
    });
});
