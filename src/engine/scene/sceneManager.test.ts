import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {EntityCommandBufferSystem, World} from "../core";
import type {Entity} from "../core";
import {LocalPosition} from "../translation/localPosition";
import {Parent} from "../translation/parent";
import {encodePpm} from "../assets/image/ppm";
import {consoleOverride} from "../debugging";
import {originalConsole} from "../debugging/originalConsole";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {EditorOnly} from "./editorOnly";
import {FIRST_SCENE_ENTITY_ID, parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneDocument, SceneFieldValues} from "./sceneDocument";
import {applySceneInPlace, deserializeInto, sceneEntitiesInCreationOrder, serializeWorld} from "./sceneSerialization";
import {SceneInstance, withoutSceneMembership} from "./sceneInstance";
import {SceneManager} from "./sceneManager";
import {PrefabSpawner} from "./prefabSpawner";
import type {LoadedScene, ScenePreload} from "./sceneManager";

const FIRST_PATH = "scenes/first.scene.json";
const SECOND_PATH = "scenes/second.scene.json";
const THIRD_PATH = "scenes/third.scene.json";
const SPRITE_PATH = "sprites/dot.ppm";
const MISSING_PATH = "scenes/missing.scene.json";
const FOREIGN_SCENE_ID = 99;
const FOREIGN_PATH = "scenes/elsewhere.scene.json";
const RED_PIXEL_RGBA = new Uint8Array([255, 0, 0, 255]);
const ORIGIN = [0, 0, 0];

interface PlannedEntity {
    readonly name: string;
    readonly parent?: string;
    readonly components?: {readonly [typeName: string]: SceneFieldValues};
}

interface Setup {
    readonly world: World;
    readonly registry: ComponentSchemaRegistry;
    readonly scenes: SceneManager;
}

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

function setup(files: Readonly<Record<string, string | Uint8Array>> = {}, preload?: ScenePreload): Setup {
    const world = new World({platform: new MemoryPlatform({files: {[SPRITE_PATH]: encodePpm(1, 1, RED_PIXEL_RGBA), ...files}})});
    const registry = engineRegistry();
    return {world, registry, scenes: new SceneManager(world, registry, {preload})};
}

function documentOf(...planned: readonly PlannedEntity[]): SceneDocument {
    const idOf = (name: string) => planned.findIndex(entry => entry.name === name) + FIRST_SCENE_ENTITY_ID;
    return parseSceneDocument({
        format: SCENE_DOCUMENT_FORMAT,
        version: SCENE_DOCUMENT_VERSION,
        entities: planned.map((entry, index) => ({
            id: index + FIRST_SCENE_ENTITY_ID,
            name: entry.name,
            enabled: true,
            components: {
                LocalPosition: {xyz: ORIGIN},
                ...(entry.parent === undefined ? {} : {Parent: {entity: idOf(entry.parent)}}),
                ...entry.components,
            },
        })),
    });
}

function familyOf(prefix: string): SceneDocument {
    return documentOf({name: `${prefix}Root`}, {name: `${prefix}Child`, parent: `${prefix}Root`}, {name: `${prefix}Grandchild`, parent: `${prefix}Child`});
}

function namesIn(world: World): (string | undefined)[] {
    return sceneEntitiesInCreationOrder(world).map(entity => world.entityManager.nameOf(entity));
}

function entityNamed(world: World, name: string): Entity {
    const entity = sceneEntitiesInCreationOrder(world).find(candidate => world.entityManager.nameOf(candidate) === name);
    if (entity === undefined) throw new Error(`no entity named ${name}`);
    return entity;
}

function persistentEntity(world: World, name: string): Entity {
    return world.entityManager.createEntity(name, [new LocalPosition()]);
}

function ignore(): void {
}

function consoleErrorsDuring(action: () => void): string[] {
    const errors: string[] = [];
    const methods: Record<string, (...args: unknown[]) => void> = {};
    for (const key in originalConsole) methods[key] = ignore;
    methods.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
    const recorder = methods as unknown as Console;
    consoleOverride.removeConsoleEventListener(originalConsole);
    consoleOverride.addConsoleEventListener(recorder);
    try {
        action();
    } finally {
        consoleOverride.removeConsoleEventListener(recorder);
        consoleOverride.addConsoleEventListener(originalConsole);
    }
    return errors;
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error("expected the promise to reject");
}

describe("SceneManager loading", () => {
    test("a single load replaces every loaded scene, keeps persistent and EditorOnly entities, and becomes the active scene", () => {
        const {world, scenes} = setup();
        const em = world.entityManager;
        const persistent = persistentEntity(world, "persistent");
        em.createEntity("persistentChild", [new LocalPosition(), new Parent(persistent)]);
        const editorCamera = em.createEntity("editorCamera", [new LocalPosition(), new EditorOnly()]);
        scenes.loadDocument(familyOf("first"), {path: FIRST_PATH});
        scenes.loadDocument(familyOf("extra"), {mode: "additive", path: SECOND_PATH});

        const replacing = scenes.loadDocument(familyOf("third"), {path: THIRD_PATH});
        expect(namesIn(world)).toEqual(["persistent", "persistentChild", "thirdRoot", "thirdChild", "thirdGrandchild"]);
        expect(em.exists(editorCamera)).toBe(true);
        expect(replacing.mode).toBe("single");
        expect(replacing.handle.path).toBe(THIRD_PATH);
        expect(replacing.roots).toEqual([entityNamed(world, "thirdRoot")]);
        expect(scenes.loaded()).toEqual([replacing.handle]);
        expect(scenes.active()).toBe(replacing.handle);
        expect(scenes.sceneOf(entityNamed(world, "thirdGrandchild"))).toBe(replacing.handle);
        expect(scenes.sceneOf(persistent)).toBeUndefined();
        expect(scenes.sceneOf(editorCamera)).toBeUndefined();
    });

    test("a single load that destroys persistent entities keeps only EditorOnly ones", () => {
        const {world, scenes} = setup();
        persistentEntity(world, "persistent");
        const editorCamera = world.entityManager.createEntity("editorCamera", [new LocalPosition(), new EditorOnly()]);
        scenes.loadDocument(familyOf("first"), {path: FIRST_PATH});

        const opened = scenes.loadDocument(familyOf("second"), {mode: "single", persistentEntities: "destroy", path: SECOND_PATH});
        expect(namesIn(world)).toEqual(["secondRoot", "secondChild", "secondGrandchild"]);
        expect(world.entityManager.exists(editorCamera)).toBe(true);
        expect(scenes.loaded()).toEqual([opened.handle]);
        expect(scenes.active()).toBe(opened.handle);
        expect(() => scenes.loadDocument(familyOf("third"), {mode: "additive", persistentEntities: "destroy"}))
            .toThrow("only a single load can destroy persistent entities");
    });

    test("an additive load keeps the loaded scenes and the active scene; the first one loaded becomes active", () => {
        const {world, scenes} = setup();
        persistentEntity(world, "persistent");
        const first = scenes.loadDocument(familyOf("first"), {mode: "additive", path: FIRST_PATH});
        expect(scenes.active()).toBe(first.handle);

        const second = scenes.loadDocument(familyOf("second"), {mode: "additive", path: SECOND_PATH});
        expect(second.mode).toBe("additive");
        expect(scenes.active()).toBe(first.handle);
        expect(scenes.loaded()).toEqual([first.handle, second.handle]);
        expect(second.handle.id).toBeGreaterThan(first.handle.id);
        expect(namesIn(world)).toEqual(["persistent", "firstRoot", "firstChild", "firstGrandchild", "secondRoot", "secondChild", "secondGrandchild"]);
        expect(scenes.sceneOf(entityNamed(world, "firstChild"))).toBe(first.handle);
        expect(scenes.sceneOf(entityNamed(world, "secondChild"))).toBe(second.handle);
    });

    test("a SceneInstance or ActiveScene inside a loaded document is ignored and replaced by the loader", () => {
        const {world, scenes} = setup();
        const foreign = {SceneInstance: {sceneId: FOREIGN_SCENE_ID, path: FOREIGN_PATH}};
        const document = documentOf({name: "tagged", components: foreign}, {name: "taggedChild", parent: "tagged", components: foreign});
        document.resources = {ActiveScene: {sceneId: FOREIGN_SCENE_ID, path: FOREIGN_PATH}};

        const loaded = scenes.loadDocument(document, {path: FIRST_PATH});
        expect(loaded.handle.id).not.toBe(FOREIGN_SCENE_ID);
        expect(scenes.loaded()).toEqual([loaded.handle]);
        expect(scenes.active()).toBe(loaded.handle);
        const tag = world.entityManager.getComponent<SceneInstance>(entityNamed(world, "tagged"), SceneInstance)!;
        expect([tag.sceneId, tag.path]).toEqual([loaded.handle.id, FIRST_PATH]);
        expect(world.entityManager.hasComponent(entityNamed(world, "taggedChild"), SceneInstance)).toBe(false);
    });

    test("a document that fails to load leaves the world, the loaded scenes and the active scene unchanged", async () => {
        const {world, scenes} = setup();
        const first = scenes.loadDocument(familyOf("first"), {path: FIRST_PATH});
        const announced: LoadedScene[] = [];
        scenes.onLoaded(scene => announced.push(scene));
        const before = namesIn(world);
        const broken = documentOf({name: "broken", components: {NotRegistered: {}}});

        expect(() => scenes.loadDocument(broken)).toThrow('the component type "NotRegistered" is not registered');
        expect((await rejectionOf(scenes.load(MISSING_PATH))).includes(MISSING_PATH)).toBe(true);
        expect(namesIn(world)).toEqual(before);
        expect(scenes.loaded()).toEqual([first.handle]);
        expect(scenes.active()).toBe(first.handle);
        expect(announced).toEqual([]);
    });

    test("load preloads the scene file, then its assets, and names the scene by its path", async () => {
        const document = documentOf({name: "dot", components: {Sprite: {image: {path: SPRITE_PATH}}}});
        const preloaded: string[][] = [];
        const {world, scenes} = setup({[FIRST_PATH]: JSON.stringify(document)}, async paths => {
            preloaded.push([...paths]);
        });

        const handle = await scenes.load(FIRST_PATH, {mode: "additive"});
        expect(preloaded).toEqual([[FIRST_PATH], [SPRITE_PATH]]);
        expect(handle.path).toBe(FIRST_PATH);
        expect(scenes.active()).toBe(handle);
        expect(scenes.sceneOf(entityNamed(world, "dot"))).toBe(handle);
    });

    test("the manager needs the engine schemas so membership is saved with the world", () => {
        const world = new World({platform: new MemoryPlatform()});
        expect(() => new SceneManager(world, new ComponentSchemaRegistry())).toThrow("call registerEngineComponentSchemas");
    });
});

describe("SceneManager unloading and membership", () => {
    test("unload destroys exactly that scene's roots and descendants, and the next loaded scene becomes active", () => {
        const {world, scenes} = setup();
        const em = world.entityManager;
        const persistent = persistentEntity(world, "persistent");
        const first = scenes.loadDocument(documentOf({name: "firstRoot"}, {name: "firstChild", parent: "firstRoot"}, {name: "adopted"}), {path: FIRST_PATH});
        const second = scenes.loadDocument(familyOf("second"), {mode: "additive", path: SECOND_PATH});
        const adopted = entityNamed(world, "adopted");
        em.addComponent(adopted, new Parent(persistent));
        const hitchhiker = em.createEntity("hitchhiker", [new LocalPosition(), new Parent(entityNamed(world, "firstChild"))]);

        scenes.unload(first.handle);
        expect(namesIn(world)).toEqual(["persistent", "adopted", "secondRoot", "secondChild", "secondGrandchild"]);
        expect(em.exists(hitchhiker)).toBe(false);
        expect(em.hasComponent(adopted, SceneInstance)).toBe(false);
        expect(scenes.loaded()).toEqual([second.handle]);
        expect(scenes.active()).toBe(second.handle);
        expect(() => scenes.unload(first.handle)).toThrow(`scene ${first.handle.id} (${FIRST_PATH}) is not loaded`);

        em.removeComponent(adopted, Parent);
        expect(scenes.sceneOf(adopted)).toBeUndefined();
        scenes.unload(second.handle);
        expect(namesIn(world)).toEqual(["persistent", "adopted"]);
        expect(scenes.loaded()).toEqual([]);
        expect(scenes.active()).toBeUndefined();
    });

    test("setActive picks the scene moveToScene uses by default; moveToScene takes only root scene entities into loaded scenes", () => {
        const {world, scenes} = setup();
        const em = world.entityManager;
        const spawned = persistentEntity(world, "spawned");
        expect(() => scenes.moveToScene(spawned)).toThrow("no scene is active");
        const first = scenes.loadDocument(familyOf("first"), {mode: "additive", path: FIRST_PATH});
        const second = scenes.loadDocument(familyOf("second"), {mode: "additive", path: SECOND_PATH});

        scenes.setActive(second.handle);
        expect(scenes.active()).toBe(second.handle);
        scenes.moveToScene(spawned);
        expect(scenes.sceneOf(spawned)).toBe(second.handle);
        scenes.moveToScene(spawned, first.handle);
        expect(scenes.sceneOf(spawned)).toBe(first.handle);
        expect(() => scenes.moveToScene(entityNamed(world, "secondChild"))).toThrow("has a parent");
        const editorCamera = em.createEntity("editorCamera", [new LocalPosition(), new EditorOnly()]);
        expect(() => scenes.moveToScene(editorCamera)).toThrow("is not a scene entity");

        scenes.unload(first.handle);
        expect(em.exists(spawned)).toBe(false);
        expect(() => scenes.setActive(first.handle)).toThrow("is not loaded");
        expect(() => scenes.moveToScene(persistentEntity(world, "late"), first.handle)).toThrow("is not loaded");
        expect(scenes.active()).toBe(second.handle);
    });

    test("an empty scene stays loaded while it is the active scene", () => {
        const {scenes} = setup();
        const empty = scenes.loadDocument(documentOf(), {path: FIRST_PATH});
        expect(scenes.loaded()).toEqual([empty.handle]);
        expect(scenes.active()).toBe(empty.handle);
        scenes.unload(empty.handle);
        expect(scenes.active()).toBeUndefined();
    });

    test("onLoaded announces each load with its handle, mode and roots until unsubscribed, and a failing listener does not stop the others", () => {
        const {world, scenes} = setup();
        const announced: LoadedScene[] = [];
        const unsubscribe = scenes.onLoaded(scene => announced.push(scene));
        const first = scenes.loadDocument(familyOf("first"), {path: FIRST_PATH});
        expect(announced).toEqual([first]);
        expect(announced[0].roots).toEqual([entityNamed(world, "firstRoot")]);
        unsubscribe();
        scenes.loadDocument(familyOf("second"), {mode: "additive"});
        expect(announced.length).toBe(1);

        const after: LoadedScene[] = [];
        scenes.onLoaded(() => {
            throw new Error("listener exploded");
        });
        scenes.onLoaded(scene => after.push(scene));
        let third: LoadedScene | undefined;
        const errors = consoleErrorsDuring(() => {
            third = scenes.loadDocument(familyOf("third"), {mode: "additive", path: THIRD_PATH});
        });
        expect(after).toEqual([third]);
        expect(errors.length).toBe(1);
        expect(errors[0].includes(THIRD_PATH) && errors[0].includes("listener exploded")).toBe(true);
    });
});

describe("SceneManager membership in saved worlds", () => {
    test("membership and the active scene survive a snapshot restored in place after the game switched scenes", () => {
        const {world, registry, scenes} = setup();
        const persistent = persistentEntity(world, "persistent");
        const first = scenes.loadDocument(familyOf("first"), {path: FIRST_PATH});
        const second = scenes.loadDocument(familyOf("second"), {mode: "additive", path: SECOND_PATH});
        scenes.setActive(second.handle);
        const snapshot = serializeWorld(world, registry);

        const played = scenes.loadDocument(familyOf("third"), {path: THIRD_PATH});
        expect(scenes.loaded()).toEqual([played.handle]);
        applySceneInPlace(world, registry, snapshot);

        expect(scenes.loaded().map(handle => [handle.id, handle.path])).toEqual([[first.handle.id, FIRST_PATH], [second.handle.id, SECOND_PATH]]);
        expect(scenes.active()?.id).toBe(second.handle.id);
        expect(scenes.sceneOf(entityNamed(world, "firstGrandchild"))?.id).toBe(first.handle.id);
        expect(scenes.sceneOf(persistent)).toBeUndefined();
        expect(scenes.loadDocument(familyOf("later"), {mode: "additive"}).handle.id).toBeGreaterThan(played.handle.id);
    });

    test("membership and the active scene survive a snapshot loaded into a fresh world, whose new scenes get unused ids", () => {
        const {world, registry, scenes} = setup();
        persistentEntity(world, "persistent");
        const first = scenes.loadDocument(familyOf("first"), {path: FIRST_PATH});
        const second = scenes.loadDocument(familyOf("second"), {mode: "additive", path: SECOND_PATH});
        const saved = serializeWorld(world, registry);

        const target = new World({platform: new MemoryPlatform()});
        const targetScenes = new SceneManager(target, registry);
        deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)));
        expect(targetScenes.loaded().map(handle => [handle.id, handle.path])).toEqual([[first.handle.id, FIRST_PATH], [second.handle.id, SECOND_PATH]]);
        expect(targetScenes.active()?.id).toBe(first.handle.id);
        expect(targetScenes.sceneOf(entityNamed(target, "persistent"))).toBeUndefined();
        expect(targetScenes.loadDocument(familyOf("third"), {mode: "additive"}).handle.id).toBe(second.handle.id + 1);
    });

    test("withoutSceneMembership drops SceneInstance and ActiveScene and keeps everything else", () => {
        const document = documentOf({name: "root", components: {SceneInstance: {sceneId: 1, path: FIRST_PATH}}}, {name: "plain"});
        document.resources = {ActiveScene: {sceneId: 1, path: FIRST_PATH}, Scoreboard: {wave: 3}};
        const stripped = withoutSceneMembership(document);
        expect(stripped.entities[0].components).toEqual({LocalPosition: {xyz: ORIGIN}});
        expect(stripped.entities[1]).toBe(document.entities[1]);
        expect(stripped.resources).toEqual({Scoreboard: {wave: 3}});
        expect(document.entities[0].components.SceneInstance).toEqual({sceneId: 1, path: FIRST_PATH});

        document.resources = {ActiveScene: {sceneId: 1, path: FIRST_PATH}};
        expect("resources" in withoutSceneMembership(document)).toBe(false);
    });
});

describe("SceneManager activation and archetypes", () => {
    test("a scene activated on command-buffer playback exists disabled until the next playback, and authored-disabled entities stay disabled", () => {
        const {world, scenes} = setup();
        const document = familyOf("late");
        document.entities[2].enabled = false;
        const loaded = scenes.loadDocument(document, {activation: "onCommandBufferPlayback"});
        const entityManager = world.entityManager;
        expect(loaded.entities.map(entity => entityManager.exists(entity))).toEqual([true, true, true]);
        expect(loaded.entities.map(entity => entityManager.isEnabled(entity))).toEqual([false, false, false]);
        world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().playback(entityManager);
        expect(loaded.entities.map(entity => entityManager.isEnabled(entity))).toEqual([true, true, false]);
        expect(scenes.sceneOf(loaded.entities[1])).toBe(loaded.handle);
    });

    test("an immediate load is enabled at once", () => {
        const {world, scenes} = setup();
        const loaded = scenes.loadDocument(familyOf("now"));
        expect(loaded.entities.every(entity => world.entityManager.isEnabled(entity))).toBe(true);
    });

    test("a scene unloaded before its activation playback leaves nothing for the playback to act on", () => {
        const {world, scenes} = setup();
        const loaded = scenes.loadDocument(familyOf("gone"), {activation: "onCommandBufferPlayback"});
        scenes.unload(loaded.handle);
        world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().playback(world.entityManager);
        expect(loaded.entities.some(entity => world.entityManager.exists(entity))).toBe(false);
    });

    test("a load prunes the archetypes it created and emptied, and keeps empty archetypes that existed before", () => {
        const {world, scenes} = setup();
        const before = persistentEntity(world, "before");
        world.entityManager.destroyEntity(before);
        const emptyBefore = [...world.archetypes.values()].filter(archetype => archetype.entityCountIncludingDisabled === 0 && archetype.componentTypes.length > 0);
        expect(emptyBefore.length).toBeGreaterThan(0);
        scenes.loadDocument(familyOf("tidy"));
        const empty = [...world.archetypes.values()].filter(archetype => archetype.entityCountIncludingDisabled === 0 && archetype.componentTypes.length > 0);
        expect(empty).toEqual(emptyBefore);
    });

    test("creating a SceneManager gives the world a PrefabSpawner", () => {
        const {world} = setup();
        expect(world.resources.tryGet(PrefabSpawner)).toBeInstanceOf(PrefabSpawner);
    });
});
