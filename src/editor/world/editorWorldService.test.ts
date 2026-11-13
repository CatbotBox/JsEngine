import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {Component, EntityCommandBufferSystem, NULL_ENTITY, System, World} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {Children} from "../../engine/translation/children";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Parent, ParentTransform} from "../../engine/translation/parent";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {Sprite} from "../../engine/rendering/2d/sprite";
import {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {encodePpm} from "../../engine/assets/image/ppm";
import {Vec} from "../../engine/math/types/vec";
import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../engine/scene";
import type {SceneJsonValue} from "../../engine/scene";
import {EDITOR_MESSAGE_TYPE} from "../editorProtocol";
import type {EditorEntityDetails, EditorEntitySummary, EditorRequest, EditorResultOf} from "../editorProtocol";
import {EditorClient, EditorRequestError} from "../page/editorClient";
import {attachEditorWorldService} from "./editorWorldService";
import {subtreeOf} from "./entityEditing";
import type {EditorWorldService} from "./editorWorldService";

const TICK_MS = 2;
const WAIT_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 2;
const SETTLE_FRAMES = 5;
const PLAY_RUNS = 3;
const SPRITE_PATH = "sprites/dot.ppm";
const RED_PIXEL_RGBA = new Uint8Array([255, 0, 0, 255]);
const INLINE_SPRITE_WIDTH = 2;
const INLINE_SPRITE_HEIGHT = 3;
const GREEN_RGB = 0x00FF00;
const DELIVERY_DELAY_MS = 0;
const DISABLED = false;
const PRELOAD_DELAY_MS = 10;

class GameplayCounterSystem extends System {
    public runs = 0;

    public onUpdate(): void {
        this.runs++;
    }
}

class SwitchedOffGameplaySystem extends System {
    public runs = 0;

    public onUpdate(): void {
        this.runs++;
    }
}

class RenderProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    public onUpdate(): void {
        this.frames++;
    }
}

class UnregisteredTag extends Component {
}

type MessageListener = (event: {readonly data: unknown}) => void;

class MessagePipe {
    public failingDeliveries = 0;
    private readonly listeners: MessageListener[] = [];

    public listen(listener: MessageListener): void {
        this.listeners.push(listener);
    }

    public deliver(message: unknown): void {
        if (this.failingDeliveries > 0) {
            this.failingDeliveries--;
            throw new Error("DataCloneError: simulated");
        }
        const data = structuredClone(message);
        setTimeout(() => {
            for (const listener of this.listeners) listener({data});
        }, DELIVERY_DELAY_MS);
    }
}

interface Harnessed {
    readonly world: World;
    readonly service: EditorWorldService;
    readonly client: EditorClient;
    readonly counter: GameplayCounterSystem;
    readonly switchedOff: SwitchedOffGameplaySystem;
    readonly probe: RenderProbeSystem;
    readonly toWorld: MessagePipe;
    readonly toPage: MessagePipe;
    readonly preloaded: string[][];
}

const running: Harnessed[] = [];

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

afterEach(() => {
    for (const harnessed of running.splice(0)) {
        harnessed.client.close();
        harnessed.service.detach();
    }
});

function editorWorld(populate: (world: World) => void = () => undefined): Harnessed {
    const platform = new MemoryPlatform({files: {[SPRITE_PATH]: encodePpm(1, 1, RED_PIXEL_RGBA)}});
    const world = new World({platform});
    world.targetDeltaTimeMs = TICK_MS;
    world.ensureSystemExists(EntityCommandBufferSystem);
    const probe = world.getOrCreateSystem(RenderProbeSystem);
    const counter = world.getOrCreateSystem(GameplayCounterSystem);
    const switchedOff = world.getOrCreateSystem(SwitchedOffGameplaySystem);
    switchedOff.enabled = false;
    populate(world);

    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    const toWorld = new MessagePipe();
    const toPage = new MessagePipe();
    const preloaded: string[][] = [];
    const service = attachEditorWorldService({
        postMessage: message => toPage.deliver(message),
        addEventListener: (_type, listener) => toWorld.listen(listener),
    }, world, registry, {
        preloadAssets: async paths => {
            preloaded.push([...paths]);
            await sleep(PRELOAD_DELAY_MS);
        },
    });
    const client = new EditorClient({
        postMessage: message => toWorld.deliver(message),
        addEventListener: (_type, listener) => toPage.listen(listener),
    });
    const harnessed = {world, service, client, counter, switchedOff, probe, toWorld, toPage, preloaded};
    running.push(harnessed);
    return harnessed;
}

function ask<R extends EditorRequest>(harnessed: Harnessed, request: R): Promise<EditorResultOf<R>> {
    return harnessed.client.request(request);
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(EditorRequestError);
        return (error as Error).message;
    }
    throw new Error("expected the editor request to fail");
}

async function waitUntil(condition: () => boolean): Promise<boolean> {
    const deadline = performance.now() + WAIT_TIMEOUT_MS;
    while (!condition()) {
        if (performance.now() > deadline) return false;
        await sleep(POLL_INTERVAL_MS);
    }
    return true;
}

async function framesPass(harnessed: Harnessed, frames: number = SETTLE_FRAMES): Promise<boolean> {
    const target = harnessed.probe.frames + frames;
    return waitUntil(() => harnessed.probe.frames >= target);
}

function byName(entities: readonly EditorEntitySummary[], name: string): EditorEntitySummary | undefined {
    return entities.find(entity => entity.name === name);
}

function fieldsOf(details: EditorEntityDetails, typeName: string): {readonly [key: string]: unknown} | undefined {
    return details.components.find(component => component.typeName === typeName)?.fields;
}

function childrenOf(world: World, parent: Entity): readonly Entity[] {
    return world.entityManager.getComponent<Children>(parent, Children)?.children ?? [];
}

describe("EditorWorldService requests", () => {
    test("describeSchemas lists every registered type with its persistence, field kinds, nullability and enum names", async () => {
        const harnessed = editorWorld();
        const {components} = await ask(harnessed, {op: "describeSchemas"});
        const described = (typeName: string) => components.find(component => component.typeName === typeName);
        expect(described("LocalPosition")).toEqual({typeName: "LocalPosition", persistence: "fields", fields: [{key: "xyz", kind: "vec3"}]});
        expect(described("Parent")).toEqual({typeName: "Parent", persistence: "fields", fields: [{key: "entity", kind: "entity", nullable: false}]});
        expect(described("RenderMesh")?.fields.find(field => field.key === "faceCulling"))
            .toEqual({key: "faceCulling", kind: "enum", enumNames: ["BackFaces", "FrontFaces", "None"]});
        expect(described("TextSprite")?.fields.find(field => field.key === "transparentChar")).toEqual({key: "transparentChar", kind: "string", nullable: true});
        expect(described("LocalToWorld")).toEqual({typeName: "LocalToWorld", persistence: "presenceOnly", fields: []});
        expect(described("Children")?.persistence).toBe("implied");
    });

    test("listEntities reports creation order, names, enabled state, live parents and registered then unregistered component names", async () => {
        const harnessed = editorWorld(world => {
            const root = world.entityManager.createEntity("root", [new LocalPosition(), new LocalToWorld()]);
            world.entityManager.createEntity("child", [new LocalPosition(), new LocalToWorld(), new Parent(root), new UnregisteredTag()]);
            const hidden = world.entityManager.createEntity(undefined, [new LocalPosition()]);
            world.entityManager.setEnabledState(hidden, DISABLED);
        });
        const {entities} = await ask(harnessed, {op: "listEntities"});
        expect(entities.map(entity => entity.name)).toEqual(["root", "child", null]);
        const [root, child, hidden] = entities;
        expect(root.parent).toBe(null);
        expect(child.parent).toBe(root.entity);
        expect(child.componentTypeNames).toEqual(["LocalPosition", "Parent", "LocalToWorld", "ParentTransform", "UnregisteredTag"]);
        expect(root.componentTypeNames).toEqual(["LocalPosition", "LocalToWorld", "Children"]);
        expect([root.enabled, child.enabled, hidden.enabled]).toEqual([true, true, false]);
    });

    test("getEntity encodes registered fields, summarises inline sprite images and lists unregistered components as not inspectable", async () => {
        let entity = NULL_ENTITY;
        const harnessed = editorWorld(world => {
            const sprite = new Sprite(SpriteImage.solid(INLINE_SPRITE_WIDTH, INLINE_SPRITE_HEIGHT, GREEN_RGB), GREEN_RGB);
            entity = world.entityManager.createEntity("dot", [new LocalPosition(1, 2, 3), sprite, new LocalToWorld(), new UnregisteredTag()]);
        });
        const details = await ask(harnessed, {op: "getEntity", entity});
        expect([details.entity, details.name, details.enabled, details.parent]).toEqual([entity, "dot", true, null]);
        expect(details.components.map(component => [component.typeName, component.inspectable]))
            .toEqual([
                ["LocalPosition", true],
                ["Sprite", true],
                ["LocalToWorld", false],
                ["RenderBounds", false],
                ["WorldSpaceRenderBounds", false],
                ["UnregisteredTag", false],
            ]);
        expect(fieldsOf(details, "LocalPosition")).toEqual({xyz: [1, 2, 3]});
        expect(fieldsOf(details, "Sprite")).toEqual({image: {inline: {width: INLINE_SPRITE_WIDTH, height: INLINE_SPRITE_HEIGHT}}, tint: "#00ff00", opacity: 1});
        expect(fieldsOf(details, "UnregisteredTag")).toEqual({});
        expect(await failureOf(ask(harnessed, {op: "getEntity", entity: NULL_ENTITY}))).toBe('Editor request "getEntity" failed: No entity 0 in this world');
    });

    test("setField decodes through the codec, assigns through the tracked component, and the next edit ticks propagate it", async () => {
        let entity = NULL_ENTITY;
        const harnessed = editorWorld(world => {
            entity = world.entityManager.createEntity("dot", [new LocalPosition(), new LocalToWorld(), new Sprite(SpriteImage.solid(1, 1, GREEN_RGB))]);
        });
        expect(await ask(harnessed, {op: "setField", entity, typeName: "LocalPosition", key: "xyz", value: [4, 5, "Infinity"]}))
            .toEqual({value: [4, 5, "Infinity"]});
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity}), "LocalPosition")).toEqual({xyz: [4, 5, "Infinity"]});
        const localToWorld = harnessed.world.entityManager.getComponent<LocalToWorld>(entity, LocalToWorld)!;
        expect(await waitUntil(() => Vec.x(localToWorld.position) === 4)).toBe(true);
        expect(await ask(harnessed, {op: "setField", entity, typeName: "Sprite", key: "tint", value: "#123456"})).toEqual({value: "#123456"});
        expect(await ask(harnessed, {op: "setField", entity, typeName: "Sprite", key: "image", value: {path: SPRITE_PATH}})).toEqual({value: {path: SPRITE_PATH}});
        expect(harnessed.preloaded).toEqual([[SPRITE_PATH]]);

        const failure = (typeName: string, key: string, value: SceneJsonValue) =>
            failureOf(ask(harnessed, {op: "setField", entity, typeName, key, value}));
        expect(await failure("Nope", "xyz", [0, 0, 0])).toBe('Editor request "setField" failed: No component type named "Nope" is registered');
        expect(await failure("LocalPosition", "x", 0)).toBe('Editor request "setField" failed: LocalPosition has no field "x"');
        expect(await failure("LocalPosition", "xyz", [0, 0])).toBe('Editor request "setField" failed: Scene field LocalPosition.xyz: expected an array of 3 numbers, got [0,0]');
        expect(await failure("LocalToWorld", "matrix", [])).toBe('Editor request "setField" failed: LocalToWorld is presenceOnly: the editor only adds, removes and edits components saved with their fields');
        expect(await failure("Camera", "nearPlaneDistance", 1)).toBe(`Editor request "setField" failed: Entity ${entity} has no Camera`);
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity}), "LocalPosition")).toEqual({xyz: [4, 5, "Infinity"]});
    });

    test("setField on Parent re-parents, keeps both Children lists in step and refuses a cycle or null", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            const first = world.entityManager.createEntity("first", [new LocalPosition(), new LocalToWorld()]);
            const second = world.entityManager.createEntity("second", [new LocalPosition(), new LocalToWorld()]);
            const child = world.entityManager.createEntity("child", [new LocalPosition(), new LocalToWorld(), new Parent(first)]);
            world.entityManager.getComponent<Children>(first, Children)!.addChild(child);
            handles.push(first, second, child);
        });
        const [first, second, child] = handles;
        expect(await ask(harnessed, {op: "setField", entity: child, typeName: "Parent", key: "entity", value: second})).toEqual({value: second});
        expect(childrenOf(harnessed.world, first)).toEqual([]);
        expect(childrenOf(harnessed.world, second)).toEqual([child]);
        expect(await framesPass(harnessed)).toBe(true);
        expect(harnessed.world.entityManager.getComponent<Parent>(child, Parent)!.entity).toBe(second);

        expect(await failureOf(ask(harnessed, {op: "setField", entity: second, typeName: "Parent", key: "entity", value: child})))
            .toBe(`Editor request "setField" failed: Entity ${second} has no Parent`);
        expect(await failureOf(ask(harnessed, {op: "setField", entity: child, typeName: "Parent", key: "entity", value: child})))
            .toBe(`Editor request "setField" failed: Entity ${child} is entity ${child} or one of its descendants, so it cannot become its parent`);
        expect(await failureOf(ask(harnessed, {op: "setField", entity: child, typeName: "Parent", key: "entity", value: null})))
            .toBe('Editor request "setField" failed: Parent.entity cannot be null; remove the Parent component instead');
        expect(await failureOf(ask(harnessed, {op: "setField", entity: child, typeName: "Parent", key: "entity", value: 999})))
            .toBe('Editor request "setField" failed: Parent.entity names no entity of this world');
    });

    test("addComponent and removeComponent take registered fields types only; Parent needs its entity and removing it unparents", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles.push(world.entityManager.createEntity("root", [new LocalPosition(), new LocalToWorld()]));
            handles.push(world.entityManager.createEntity("loose", [new LocalPosition(), new LocalToWorld()]));
        });
        const [root, loose] = handles;
        const added = await ask(harnessed, {op: "addComponent", entity: loose, typeName: "Camera", values: {farPlaneDistance: 50}});
        expect(fieldsOf(added, "Camera")?.farPlaneDistance).toBe(50);
        const fails = (request: EditorRequest) => failureOf(ask(harnessed, request));
        expect(await fails({op: "addComponent", entity: loose, typeName: "Camera"})).toBe(`Editor request "addComponent" failed: Entity ${loose} already has Camera`);
        expect(await fails({op: "addComponent", entity: loose, typeName: "Children"})).toBe('Editor request "addComponent" failed: Children is implied: the editor only adds, removes and edits components saved with their fields');
        expect(await fails({op: "addComponent", entity: loose, typeName: "Sprite", values: {colour: "#000000"}})).toBe('Editor request "addComponent" failed: Sprite has no field "colour"');
        expect(await fails({op: "addComponent", entity: loose, typeName: "Parent"})).toBe('Editor request "addComponent" failed: Parent needs "entity" set to an entity in its values');
        expect(await fails({op: "addComponent", entity: loose, typeName: "Parent", values: {entity: loose}}))
            .toBe(`Editor request "addComponent" failed: Entity ${loose} is entity ${loose} or one of its descendants, so it cannot become its parent`);
        expect(harnessed.world.entityManager.hasComponent(loose, ParentTransform)).toBe(false);

        const parented = await ask(harnessed, {op: "addComponent", entity: loose, typeName: "Parent", values: {entity: root}});
        expect(parented.parent).toBe(root);
        expect(childrenOf(harnessed.world, root)).toEqual([loose]);
        expect(harnessed.world.entityManager.hasComponent(loose, ParentTransform)).toBe(true);

        const unparented = await ask(harnessed, {op: "removeComponent", entity: loose, typeName: "Parent"});
        expect(unparented.parent).toBe(null);
        expect(unparented.components.map(component => component.typeName)).toEqual(["LocalPosition", "Camera", "LocalToWorld", "ScreenSize"]);
        expect(childrenOf(harnessed.world, root)).toEqual([]);
        expect(await framesPass(harnessed)).toBe(true);
        expect(harnessed.world.entityManager.hasComponent(loose, Parent)).toBe(false);

        expect(await fails({op: "removeComponent", entity: loose, typeName: "LocalToWorld"})).toBe('Editor request "removeComponent" failed: LocalToWorld is presenceOnly: the editor only adds, removes and edits components saved with their fields');
        expect(await fails({op: "removeComponent", entity: loose, typeName: "Sprite"})).toBe(`Editor request "removeComponent" failed: Entity ${loose} has no Sprite`);
    });

    test("createEntity makes LocalPosition and LocalToWorld, plus a Parent already listed in the parent's Children", async () => {
        const harnessed = editorWorld();
        const parent = await ask(harnessed, {op: "createEntity", name: "parent"});
        expect(parent.components.map(component => component.typeName)).toEqual(["LocalPosition", "LocalToWorld"]);
        const child = await ask(harnessed, {op: "createEntity", name: "child", parent: parent.entity});
        expect(child.parent).toBe(parent.entity);
        expect(child.components.map(component => component.typeName)).toEqual(["LocalPosition", "Parent", "LocalToWorld", "ParentTransform"]);
        expect(childrenOf(harnessed.world, parent.entity)).toEqual([child.entity]);
        const unnamed = await ask(harnessed, {op: "createEntity"});
        expect(unnamed.name).toBe(null);
        expect(await failureOf(ask(harnessed, {op: "createEntity", parent: 12345 as Entity}))).toBe('Editor request "createEntity" failed: No entity 12345 in this world');
    });

    test("destroyEntity destroys the descendants found through Children and Parent and unlinks the root from its parent", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            const entityManager = world.entityManager;
            const top = entityManager.createEntity("top", [new LocalPosition(), new LocalToWorld()]);
            const middle = entityManager.createEntity("middle", [new LocalPosition(), new LocalToWorld(), new Parent(top)]);
            entityManager.getComponent<Children>(top, Children)!.addChild(middle);
            const listed = entityManager.createEntity("listed", [new LocalPosition(), new LocalToWorld(), new Parent(middle)]);
            entityManager.getComponent<Children>(middle, Children)!.addChild(listed);
            const unlisted = entityManager.createEntity("unlisted", [new LocalPosition(), new LocalToWorld(), new Parent(listed)]);
            handles.push(top, middle, listed, unlisted);
        });
        const [top, middle, listed, unlisted] = handles;
        const {destroyed} = await ask(harnessed, {op: "destroyEntity", entity: middle});
        expect(destroyed).toEqual([middle, listed, unlisted]);
        expect(childrenOf(harnessed.world, top)).toEqual([]);
        expect((await ask(harnessed, {op: "listEntities"})).entities.map(entity => entity.name)).toEqual(["top"]);
        expect(await framesPass(harnessed)).toBe(true);
        expect(await failureOf(ask(harnessed, {op: "destroyEntity", entity: middle}))).toBe(`Editor request "destroyEntity" failed: No entity ${middle} in this world`);
    });

    test("setEnabled toggles one entity", async () => {
        let entity = NULL_ENTITY;
        const harnessed = editorWorld(world => {
            entity = world.entityManager.createEntity("lamp", [new LocalPosition()]);
        });
        expect((await ask(harnessed, {op: "setEnabled", entity, enabled: false})).enabled).toBe(false);
        expect(harnessed.world.entityManager.isEnabled(entity)).toBe(false);
        expect((await ask(harnessed, {op: "setEnabled", entity, enabled: true})).enabled).toBe(true);
    });

    test("saveScene returns the scene text and report; loadScene preloads the asset paths, replaces every entity and keeps the values", async () => {
        const harnessed = editorWorld(world => {
            const image = SpriteImage.fromFile(SPRITE_PATH, world.platform);
            const root = world.entityManager.createEntity("root", [new LocalPosition(1, 2, 3), new LocalToWorld(), new Sprite(image, GREEN_RGB)]);
            world.entityManager.createEntity("child", [new LocalPosition(), new LocalToWorld(), new Parent(root), new UnregisteredTag()]);
            const hidden = world.entityManager.createEntity("hidden", [new LocalPosition()]);
            world.entityManager.setEnabledState(hidden, DISABLED);
        });
        const before = await ask(harnessed, {op: "listEntities"});
        const saved = await ask(harnessed, {op: "saveScene"});
        expect(saved.report.skippedComponentTypes).toEqual([{typeName: "UnregisteredTag", entityCount: 1}]);
        expect(JSON.parse(saved.sceneText).entities.length).toBe(before.entities.length);

        const loaded = await ask(harnessed, {op: "loadScene", sceneText: saved.sceneText});
        expect(loaded.entityCount).toBe(before.entities.length);
        expect(loaded.report.droppedComponents).toEqual([]);
        expect(harnessed.preloaded).toEqual([[SPRITE_PATH]]);
        const after = await ask(harnessed, {op: "listEntities"});
        expect(after.entities.map(entity => [entity.name, entity.enabled])).toEqual(before.entities.map(entity => [entity.name, entity.enabled]));
        expect(after.entities.some(entity => before.entities.some(old => old.entity === entity.entity))).toBe(false);
        expect(byName(after.entities, "child")?.parent).toBe(byName(after.entities, "root")?.entity);
        expect((await ask(harnessed, {op: "saveScene"})).sceneText).toBe(saved.sceneText);

        expect(await failureOf(ask(harnessed, {op: "loadScene", sceneText: "{\"format\": \"something else\"}"})))
            .toBe('Editor request "loadScene" failed: Scene document: format must be "jsengine-scene", got "something else"');
        expect((await ask(harnessed, {op: "listEntities"})).entities.length).toBe(before.entities.length);
    });

    test("requests are answered in arrival order even while one waits for assets", async () => {
        const harnessed = editorWorld(world => {
            world.entityManager.createEntity("dot", [new LocalPosition(), new Sprite(SpriteImage.fromFile(SPRITE_PATH, world.platform))]);
        });
        const sceneText = (await ask(harnessed, {op: "saveScene"})).sceneText;
        const created = ask(harnessed, {op: "createEntity", name: "early"});
        const loading = ask(harnessed, {op: "loadScene", sceneText});
        const listing = ask(harnessed, {op: "listEntities"});
        await created;
        await loading;
        expect((await listing).entities.map(entity => entity.name)).toEqual(["dot"]);
    });

    test("a response that cannot be posted becomes an error response, and the queue survives when even that fails", async () => {
        const harnessed = editorWorld();
        harnessed.toPage.failingDeliveries = 1;
        expect(await failureOf(ask(harnessed, {op: "listEntities"})))
            .toBe('Editor request "listEntities" failed: The result could not be sent: DataCloneError: simulated');
        harnessed.toPage.failingDeliveries = 2;
        const lost = ask(harnessed, {op: "listEntities"}).catch((error: Error) => error.name);
        expect((await ask(harnessed, {op: "setMode", mode: "edit"})).mode).toBe("edit");
        harnessed.client.close();
        expect(await lost).toBe("EditorClientClosedError");
    });

    test("a malformed editor request gets an error response and other messages are ignored", async () => {
        const harnessed = editorWorld();
        const answers: unknown[] = [];
        harnessed.toPage.listen(event => answers.push(event.data));
        harnessed.toWorld.deliver({type: EDITOR_MESSAGE_TYPE, requestId: 99, request: {op: "explode"}});
        harnessed.toWorld.deliver({type: "init", surface: {kind: "pixels", widthPx: 1, heightPx: 1}});
        harnessed.toWorld.deliver({type: EDITOR_MESSAGE_TYPE, requestId: 100, ok: true, result: {}});
        expect(await waitUntil(() => answers.length > 0)).toBe(true);
        await sleep(SETTLE_FRAMES * TICK_MS);
        expect(answers).toEqual([{type: EDITOR_MESSAGE_TYPE, requestId: 99, ok: false, error: "Malformed editor request"}]);
    });
});

describe("EditorWorldService modes", () => {
    test("edit never runs gameplay systems, play does, paused does not, step runs them exactly once, and earlier enabled states return", async () => {
        const harnessed = editorWorld();
        const {counter, switchedOff, service, world} = harnessed;
        expect(service.mode).toBe("edit");
        expect(await framesPass(harnessed)).toBe(true);
        expect(counter.runs).toBe(0);
        expect([counter.enabled, switchedOff.enabled]).toEqual([false, false]);

        expect(await ask(harnessed, {op: "setMode", mode: "play"})).toEqual({mode: "play", gameplayTicks: 0});
        expect(counter.enabled).toBe(true);
        expect(switchedOff.enabled).toBe(false);
        expect(await waitUntil(() => counter.runs >= PLAY_RUNS)).toBe(true);
        expect(switchedOff.runs).toBe(0);
        expect(() => world.step()).toThrow("the loop is running");

        const paused = await ask(harnessed, {op: "setMode", mode: "paused"});
        expect(paused.mode).toBe("paused");
        expect(paused.gameplayTicks).toBe(counter.runs);
        const runsWhenPaused = counter.runs;
        expect(await framesPass(harnessed)).toBe(true);
        expect(counter.runs).toBe(runsWhenPaused);

        const stepped = await ask(harnessed, {op: "step"});
        expect(stepped).toEqual({mode: "paused", gameplayTicks: paused.gameplayTicks + 1});
        expect(counter.runs).toBe(runsWhenPaused + 1);
        expect(await framesPass(harnessed)).toBe(true);
        expect(counter.runs).toBe(runsWhenPaused + 1);

        expect(await ask(harnessed, {op: "setMode", mode: "edit"})).toEqual({mode: "edit", gameplayTicks: 0});
        expect(await framesPass(harnessed)).toBe(true);
        expect(counter.runs).toBe(runsWhenPaused + 1);

        const fromEdit = await ask(harnessed, {op: "step"});
        expect(fromEdit).toEqual({mode: "paused", gameplayTicks: 1});
        expect(counter.runs).toBe(runsWhenPaused + 2);

        expect(await ask(harnessed, {op: "setMode", mode: "play"})).toEqual({mode: "play", gameplayTicks: 1});
        await ask(harnessed, {op: "setMode", mode: "edit"});
        service.detach();
        expect([counter.enabled, switchedOff.enabled]).toEqual([true, false]);
    });

    test("stop restores the play snapshot in place: field values, created and destroyed entities", async () => {
        const handles: Entity[] = [];
        const harnessed = editorWorld(world => {
            handles.push(world.entityManager.createEntity("kept", [new LocalPosition(1, 2, 3), new LocalToWorld()]));
            handles.push(world.entityManager.createEntity("doomed", [new LocalPosition(7, 7, 7)]));
        });
        const [kept, doomed] = handles;
        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "setField", entity: kept, typeName: "LocalPosition", key: "xyz", value: [9, 9, 9]});
        await ask(harnessed, {op: "createEntity", name: "extra"});
        await ask(harnessed, {op: "destroyEntity", entity: doomed});
        await ask(harnessed, {op: "setMode", mode: "edit"});

        const {entities} = await ask(harnessed, {op: "listEntities"});
        expect(entities.map(entity => entity.name)).toEqual(["kept", "doomed"]);
        expect(byName(entities, "kept")?.entity).toBe(kept);
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: kept}), "LocalPosition")).toEqual({xyz: [1, 2, 3]});
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: byName(entities, "doomed")!.entity}), "LocalPosition")).toEqual({xyz: [7, 7, 7]});
    });

    test("loading a scene while playing stops play first and loads into edit mode", async () => {
        const harnessed = editorWorld(world => {
            world.entityManager.createEntity("only", [new LocalPosition()]);
        });
        const sceneText = (await ask(harnessed, {op: "saveScene"})).sceneText;
        await ask(harnessed, {op: "setMode", mode: "play"});
        await ask(harnessed, {op: "createEntity", name: "transient"});
        expect((await ask(harnessed, {op: "loadScene", sceneText})).entityCount).toBe(1);
        expect(harnessed.service.mode).toBe("edit");
        expect((await ask(harnessed, {op: "listEntities"})).entities.map(entity => entity.name)).toEqual(["only"]);
        const runs = harnessed.counter.runs;
        expect(await framesPass(harnessed)).toBe(true);
        expect(harnessed.counter.runs).toBe(runs);
    });
});

describe("editor entity editing", () => {
    test("subtreeOf follows Parent links that no Children list holds yet", () => {
        const world = new World({platform: new MemoryPlatform()});
        const entityManager = world.entityManager;
        const root = entityManager.createEntity("root", [new LocalPosition()]);
        const child = entityManager.createEntity("child", [new LocalPosition(), new Parent(root)]);
        const grandchild = entityManager.createEntity("grandchild", [new LocalPosition(), new Parent(child)]);
        expect(childrenOf(world, root)).toEqual([]);
        expect(subtreeOf(world, root)).toEqual([root, child, grandchild]);
        expect(subtreeOf(world, grandchild)).toEqual([grandchild]);
    });
});
