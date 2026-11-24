import {describe, expect, test} from "../testing/harness";
import {registerBuiltinImageDecoders} from "../assets/image/builtinDecoders";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {Component, FrameLoopSettings, UNCAPPED_RENDER_RATE, World} from "../core";
import type {Entity} from "../core";
import {Vec, Vec3, Vec4} from "../math/types/vec";
import {Quaternions} from "../math/quaternions";
import {LocalPosition} from "../translation/localPosition";
import {LocalRotation} from "../translation/localRotation";
import {LocalScale} from "../translation/localScale";
import {LocalToWorld} from "../translation/localToWorld";
import {Parent} from "../translation/parent";
import {Children} from "../translation/children";
import {EulerAngles} from "../translation/eulerAngles";
import {InterpolatedTransform} from "../translation/interpolatedTransform";
import {TranslationSystemGroup} from "../translation/translationSystemGroup";
import {LocalToWorldSystem} from "../translation/localToWorldSystem";
import {Camera} from "../rendering/camera";
import {HudElement} from "../rendering/hudElement";
import {ScreenAnchor} from "../rendering/screenAnchor";
import {RenderBounds} from "../rendering/renderBounds";
import {RenderBoundsOffset} from "../rendering/renderBoundsOffset";
import {TextSprite} from "../rendering/textSprite";
import {TextColor} from "../rendering/textColor";
import {Sprite} from "../rendering/2d/sprite";
import {SpriteImage} from "../rendering/2d/spriteImage";
import {SpritePatternColor, spritePatternImage} from "../rendering/2d/spritePattern";
import {FieldOfView} from "../rendering/3d/fieldOfView";
import {MeshRenderSettings} from "../rendering/3d/meshRenderSettings";
import {RenderMesh} from "../rendering/3d/renderMesh";
import {FaceCulling} from "../rendering/3d/faceCulling";
import {Mesh} from "../rendering/3d/mesh";
import {AmbientLight} from "../rendering/3d/lighting/ambientLight";
import {DirectionalLight} from "../rendering/3d/lighting/directionalLight";
import {PointLight} from "../rendering/3d/lighting/pointLight";
import {Lifetime} from "../motion/lifetime";
import {Velocity} from "../motion/velocity";
import {PanCamera} from "../cameraControllers/2d/panCamera";
import {FlyCamera} from "../cameraControllers/3d/flyCamera";
import {encodePpm} from "../assets/image/ppm";
import {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {registerEngineComponentSchemas} from "./engineComponentSchemas";
import {PrefabInstance} from "./prefabInstance";
import {SceneInstance} from "./sceneInstance";
import {platformSceneAssetLoader, sceneAssetPaths} from "./sceneAssets";
import type {SceneAssetLoader} from "./sceneAssets";
import {MESH_ASSET_TYPE_NAME} from "./fieldSchema";
import {parseSceneDocument, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "./sceneDocument";
import type {SceneDocument, SceneFieldValues, SceneJsonValue} from "./sceneDocument";
import {applySceneInPlace, deserializeInto, serializeWorld} from "./sceneSerialization";

const LAMP_PATTERN_ROWS = ["#.", ".#"];
const LAMP_PATTERN_RGB = 0x4FA3F7;
const MESH_PATH = "models/tri.obj";
const SPRITE_PATH = "sprites/dot.ppm";
const TRIANGLE_OBJ = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const FILLER_ENTITIES = 5;
const SETTLE_STEPS = 3;
const MATRIX_DIGITS = 4;
const IMPLIED_TYPE_NAMES = ["ParentTransform", "Children", "WorldSpaceRenderBounds", "ScreenSize"];
const UNSUPPORTED_VERSION = SCENE_DOCUMENT_VERSION + 1;
const INTERPOLATION_OFF = false;
const MISSING_SCENE_ID = 42;
const INLINE_RGBA = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 9, 8, 7, 255]);
const INLINE_SIZE = 2;
const MATRIX_COLUMN_STRIDE = 4;
const TRANSLATION_COLUMN = 12;
const ENABLED = true;
const DISABLED = false;
const PREFAB_PATH = "prefabs/hud.prefab.json";
const SCENE_INSTANCE_ID = 3;
const CATCH_UP_TICKS = 3;
const MESH_LOD_BIAS = 2;
const SCENE_INSTANCE_PATH = "scenes/lights.scene.json";
const EMPTY_LOAD_REPORT = {skippedComponentTypes: [], skippedResourceTypes: [], danglingEntityRefs: [], droppedComponents: [], changedSchemas: []};

class GameTag extends Component {
    public score = 3;
}

interface EveryComponentWorld {
    readonly root: Entity;
    readonly child: Entity;
    readonly meshHolder: Entity;
    readonly moon: Entity;
    readonly hud: Entity;
    readonly sun: Entity;
    readonly asleep: Entity;
}

function memoryPlatform(): MemoryPlatform {
    return new MemoryPlatform({files: {
        [MESH_PATH]: TRIANGLE_OBJ,
        [SPRITE_PATH]: encodePpm(1, 1, new Uint8Array([10, 20, 30, 255])),
    }});
}

function newWorld(platform: MemoryPlatform): World {
    const world = new World({platform});
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    return world;
}

function engineRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    return registry;
}

function buildEveryComponentWorld(world: World, platform: MemoryPlatform): EveryComponentWorld {
    const em = world.entityManager;

    const camera = new Camera();
    camera.nearPlaneDistance = 0.5;
    camera.farPlaneDistance = 250;
    const fieldOfView = new FieldOfView();
    fieldOfView.radians = 1.1;
    const offset = new RenderBoundsOffset();
    offset.x = 1;
    offset.y = 2;
    offset.z = 3;
    const rootRotation = new LocalRotation();
    rootRotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0.1, 0.2, 0.3));
    const panCamera = new PanCamera();
    panCamera.stepXUnits = 2;
    panCamera.stepYUnits = 0.5;
    const flyCamera = new FlyCamera();
    flyCamera.yawRad = 0.4;
    flyCamera.pitchRad = -0.2;
    flyCamera.moveStepUnits = 0.25;
    flyCamera.minFovDegrees = 20;
    const root = em.createEntity("root", [
        new LocalPosition(10, -2, 3), rootRotation, new LocalScale(2, 3, 4), new LocalToWorld(), camera, fieldOfView, offset, panCamera, flyCamera,
    ]);

    const sprite = new Sprite(SpriteImage.fromPixels(INLINE_SIZE, INLINE_SIZE, INLINE_RGBA), 0x123456);
    sprite.opacity = 0.5;
    const child = em.createEntity("child", [new LocalPosition(1, 2, 3), new LocalToWorld(), new Parent(root), sprite, new RenderBounds()]);

    const renderMesh = new RenderMesh(Mesh.fromFile(MESH_PATH, platform), 0x00FF7F);
    renderMesh.faceCulling = FaceCulling.None;
    const meshHolder = em.createEntity("meshHolder", [renderMesh, new LocalPosition(0, 0, 5), new LocalToWorld(), new InterpolatedTransform(INTERPOLATION_OFF)]);
    const velocity = new Velocity();
    velocity.xUnitsPerSecond = 1.5;
    velocity.yUnitsPerSecond = -2;
    velocity.zUnitsPerSecond = 0.25;
    const lifetime = new Lifetime();
    lifetime.durationMs = 900;
    lifetime.remainingMs = 400;
    const moon = em.createEntity("moon", [
        new LocalPosition(0, 1, 0), new LocalToWorld(), new Parent(meshHolder), new Sprite(SpriteImage.fromFile(SPRITE_PATH, platform)), velocity, lifetime,
    ]);

    const text = new TextSprite();
    text.image = ["hi", "there"];
    text.transparentChar = "#";
    text.foreground = TextColor.BRIGHT_RED;
    text.background = TextColor.rgb(1, 2, 3);
    const anchor = new ScreenAnchor();
    anchor.anchorPosition = "bottom-left";
    const hud = em.createEntity("hud", [text, new HudElement(), anchor, new PrefabInstance(PREFAB_PATH, ["/TextSprite.image"])]);

    const sunRotation = new LocalRotation();
    sunRotation.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0.7, -0.6, 0));
    const sunAngles = new EulerAngles();
    sunAngles.radians = Vec3.alloc(0.7, -0.6, 0);
    const sun = em.createEntity("sun", [new DirectionalLight(0xFFF4E0, 0.9), new LocalPosition(), sunRotation, new LocalToWorld(), sunAngles]);
    const lampSprite = new Sprite(spritePatternImage(LAMP_PATTERN_ROWS, [new SpritePatternColor("#", LAMP_PATTERN_RGB)]));
    em.createEntity("lamp", [new PointLight(14, 0x4FA3F7, 1.2), new LocalPosition(3, 2, -4), new LocalToWorld(), lampSprite]);
    const frameLoop = new FrameLoopSettings();
    frameLoop.renderRate = UNCAPPED_RENDER_RATE;
    frameLoop.maxCatchUpTicks = CATCH_UP_TICKS;
    const meshSettings = new MeshRenderSettings();
    meshSettings.lodBias = MESH_LOD_BIAS;
    em.createEntity("ambient", [new AmbientLight(0x101010, 0.3), new SceneInstance(SCENE_INSTANCE_ID, SCENE_INSTANCE_PATH), frameLoop, meshSettings]);

    const asleep = em.createEntity("asleep", [new LocalPosition(7, 7, 7)]);
    em.setEnabledState(asleep, DISABLED);
    return {root, child, meshHolder, moon, hud, sun, asleep};
}

function recordIndexNamed(document: SceneDocument, name: string): number {
    const index = document.entities.findIndex(record => record.name === name);
    if (index < 0) throw new Error(`no record named ${name}`);
    return index;
}

function componentsNamed(document: SceneDocument, name: string): {[componentName: string]: SceneFieldValues} {
    return document.entities[recordIndexNamed(document, name)].components;
}

function withNamedReferences(document: SceneDocument): Record<string, {enabled: boolean, components: SceneJsonValue}> {
    const nameById = new Map(document.entities.map(record => [record.id, record.name]));
    const byName: Record<string, {enabled: boolean, components: SceneJsonValue}> = {};
    for (const record of document.entities) {
        const components = JSON.parse(JSON.stringify(record.components)) as {[name: string]: SceneFieldValues};
        const parent = components.Parent;
        if (parent !== undefined && typeof parent.entity === "number") parent.entity = nameById.get(parent.entity) ?? null;
        byName[record.name!] = {enabled: record.enabled, components};
    }
    return byName;
}

function stepTimes(world: World, steps: number): void {
    for (let i = 0; i < steps; i++) world.step();
}

function matrixOf(world: World, entity: Entity): number[] {
    return Vec.toArray(world.entityManager.getComponent<LocalToWorld>(entity, LocalToWorld)!.matrix);
}

registerBuiltinImageDecoders();

describe("scene serialization", () => {
    test("every registered engine component round-trips through JSON into another world's handles", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const source = newWorld(platform);
        const built = buildEveryComponentWorld(source, platform);
        stepTimes(source, SETTLE_STEPS);
        const saved = serializeWorld(source, registry);
        expect(saved.report).toEqual({skippedComponentTypes: [], danglingEntityRefs: [], unsavedAssets: []});
        expect(saved.document.entities.map(record => record.name)).toEqual(["root", "child", "meshHolder", "moon", "hud", "sun", "lamp", "ambient", "asleep"]);

        const usedNames = new Set(saved.document.entities.flatMap(record => Object.keys(record.components)));
        const savedTypeNames = registry.schemas.filter(schema => schema.persistence !== "implied").map(schema => schema.name);
        expect(savedTypeNames.filter(name => !usedNames.has(name))).toEqual([]);

        const target = newWorld(platform);
        const fillers: Entity[] = [];
        for (let i = 0; i < FILLER_ENTITIES; i++) fillers.push(target.entityManager.createEntity("filler", [new LocalPosition(i, i, i)]));
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)), {assets: platformSceneAssetLoader(platform)});
        expect(loaded.report).toEqual(EMPTY_LOAD_REPORT);
        for (const filler of fillers) target.entityManager.destroyEntity(filler);

        expect(loaded.entities.filter(entity => saved.entities.includes(entity))).toEqual([]);
        const rootIndex = recordIndexNamed(saved.document, "root");
        const childIndex = recordIndexNamed(saved.document, "child");
        expect(saved.entities[rootIndex]).toBe(built.root);
        const loadedParent = target.entityManager.getComponent<Parent>(loaded.entities[childIndex], Parent)!;
        expect(loadedParent.entity).toBe(loaded.entities[rootIndex]);

        expect(serializeWorld(target, registry).document).toEqual(saved.document);
    });

    test("equal inline sprite patterns decode once per load, every sprite holding one shares that image, and each saves back inline", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const lamp: SceneJsonValue = {rows: LAMP_PATTERN_ROWS, palette: [{char: "#", rgb: "#4fa3f7"}]};
        const dot: SceneJsonValue = {rows: ["#"], palette: [{char: "#", rgb: "#4fa3f7"}]};
        const sprite = (id: number, image: SceneJsonValue) => ({id, name: `sprite${id}`, enabled: ENABLED, components: {Sprite: {image, tint: "#ffffff", opacity: 1}}});
        const document = parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [sprite(1, lamp), sprite(2, lamp), sprite(3, dot)]});
        const world = newWorld(platform);
        const loaded = deserializeInto(world, registry, document, {assets: platformSceneAssetLoader(platform)});
        const imageOf = (index: number) => world.entityManager.getComponent<Sprite>(loaded.entities[index], Sprite)!.image;
        expect(imageOf(0)?.pattern?.rows).toEqual(LAMP_PATTERN_ROWS);
        expect(imageOf(1)).toBe(imageOf(0));
        expect(imageOf(2)).not.toBe(imageOf(0));
        expect(serializeWorld(world, registry).document.entities.map(record => record.components.Sprite.image)).toEqual([lamp, lamp, dot]);
    });

    test("F32 values survive the archetype move a parent makes when its child arrives, and the child's LocalToWorld follows it", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const source = newWorld(platform);
        buildEveryComponentWorld(source, platform);
        const saved = serializeWorld(source, registry);
        const target = newWorld(platform);
        const loaded = deserializeInto(target, registry, saved.document, {assets: platformSceneAssetLoader(platform)});
        const em = target.entityManager;
        const root = loaded.entities[recordIndexNamed(saved.document, "root")];
        const child = loaded.entities[recordIndexNamed(saved.document, "child")];

        expect(em.hasComponent(root, Children)).toBe(true);
        expect(Vec.toArray(em.getComponent<LocalPosition>(root, LocalPosition)!.xyz)).toEqual([10, -2, 3]);
        expect(Vec.toArray(em.getComponent<LocalScale>(root, LocalScale)!.xyz)).toEqual([2, 3, 4]);
        const expectedRotation = Quaternions.eulerToQuat(Vec3.alloc(0.1, 0.2, 0.3));
        expect(Vec.toArray(em.getComponent<LocalRotation>(root, LocalRotation)!.xyzw)).toEqual(Vec.toArray(expectedRotation));

        target.step();
        const rootMatrix = matrixOf(target, root);
        const childMatrix = matrixOf(target, child);
        const local = [1, 2, 3];
        expect(rootMatrix[TRANSLATION_COLUMN]).toBeCloseTo(10, MATRIX_DIGITS);
        for (let axis = 0; axis < 3; axis++) {
            let expected = rootMatrix[TRANSLATION_COLUMN + axis];
            for (let column = 0; column < 3; column++) expected += rootMatrix[column * MATRIX_COLUMN_STRIDE + axis] * local[column];
            expect(childMatrix[TRANSLATION_COLUMN + axis]).toBeCloseTo(expected, MATRIX_DIGITS);
        }
        stepTimes(source, SETTLE_STEPS);
        expect(childMatrix.every((value, i) => Math.abs(value - matrixOf(source, saved.entities[recordIndexNamed(saved.document, "child")])[i]) < 1e-4)).toBe(true);
    });

    test("disabled entities stay disabled", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const source = newWorld(platform);
        buildEveryComponentWorld(source, platform);
        const saved = serializeWorld(source, registry);
        const asleepIndex = recordIndexNamed(saved.document, "asleep");
        expect(saved.document.entities[asleepIndex].enabled).toBe(false);
        expect(saved.document.entities.filter(record => !record.enabled).length).toBe(1);
        const target = newWorld(platform);
        const loaded = deserializeInto(target, registry, saved.document, {assets: platformSceneAssetLoader(platform)});
        expect(target.entityManager.isEnabled(loaded.entities[asleepIndex])).toBe(false);
        expect(target.entityManager.isEnabled(loaded.entities[recordIndexNamed(saved.document, "root")])).toBe(true);
        expect(target.enabledEntityCount).toBe(saved.document.entities.length - 1);
    });

    test("implied types are never emitted and presenceOnly types are emitted as {}", () => {
        const platform = memoryPlatform();
        const source = newWorld(platform);
        buildEveryComponentWorld(source, platform);
        stepTimes(source, SETTLE_STEPS);
        const em = source.entityManager;
        const saved = serializeWorld(source, engineRegistry());
        const root = saved.entities[recordIndexNamed(saved.document, "root")];
        expect(em.hasComponent(root, Children)).toBe(true);
        for (const record of saved.document.entities) {
            expect(Object.keys(record.components).filter(name => IMPLIED_TYPE_NAMES.includes(name))).toEqual([]);
        }
        const child = componentsNamed(saved.document, "child");
        expect(child.LocalToWorld).toEqual({});
        expect(child.RenderBounds).toEqual({});
        expect(Object.keys(child)).toEqual(["LocalPosition", "Parent", "Sprite", "LocalToWorld", "RenderBounds"]);
    });

    test("sprite images are saved inline unless they came from a file; meshes are saved by path", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const source = newWorld(platform);
        buildEveryComponentWorld(source, platform);
        const saved = serializeWorld(source, registry);
        const inline = componentsNamed(saved.document, "child").Sprite;
        expect(inline).toEqual({image: {width: INLINE_SIZE, height: INLINE_SIZE, rgbaBase64: "/wAA/wD/AIAAAP8ACQgH/w=="}, tint: "#123456", opacity: 0.5});
        expect(componentsNamed(saved.document, "moon").Sprite.image).toEqual({path: SPRITE_PATH});
        expect(componentsNamed(saved.document, "meshHolder").RenderMesh).toEqual({mesh: {path: MESH_PATH}, color: "#00ff7f", faceCulling: "None"});
        expect(sceneAssetPaths(saved.document, registry)).toEqual([{kind: "mesh", path: MESH_PATH}, {kind: "spriteImage", path: SPRITE_PATH}]);

        const target = newWorld(platform);
        const loaded = deserializeInto(target, registry, parseSceneDocument(JSON.stringify(saved.document)), {assets: platformSceneAssetLoader(platform)});
        const em = target.entityManager;
        const image = em.getComponent<Sprite>(loaded.entities[recordIndexNamed(saved.document, "child")], Sprite)!.image!;
        expect(image.sourcePath).toBeUndefined();
        expect(Array.from(image.rgba)).toEqual(Array.from(INLINE_RGBA));
        const mesh = em.getComponent<RenderMesh>(loaded.entities[recordIndexNamed(saved.document, "meshHolder")], RenderMesh)!.mesh!;
        expect(mesh.sourcePath).toBe(MESH_PATH);
        expect(mesh.triangleCount).toBe(1);
        expect(em.getComponent<Sprite>(loaded.entities[recordIndexNamed(saved.document, "moon")], Sprite)!.image!.sourcePath).toBe(SPRITE_PATH);
    });

    test("a mesh without a source path is reported unsaved", () => {
        const world = newWorld(memoryPlatform());
        world.entityManager.createEntity("generated", [new RenderMesh(Mesh.parseObj(TRIANGLE_OBJ))]);
        const saved = serializeWorld(world, engineRegistry());
        expect(saved.document.entities[0].components.RenderMesh.mesh).toBe(null);
        expect(saved.report.unsavedAssets).toEqual(["entities[0].components.RenderMesh.mesh"]);
    });

    test("a reference to a destroyed entity saves as null, is reported, and drops the Parent it would need on load", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const world = newWorld(platform);
        const em = world.entityManager;
        const parent = em.createEntity("parent", [new LocalPosition(), new LocalToWorld()]);
        em.createEntity("orphan", [new LocalPosition(), new LocalToWorld(), new Parent(parent)]);
        em.destroyEntity(parent);
        const saved = serializeWorld(world, registry);
        expect(saved.document.entities.map(record => record.name)).toEqual(["orphan"]);
        expect(saved.document.entities[0].components.Parent).toEqual({entity: null});
        expect(saved.report.danglingEntityRefs).toEqual(["entities[0].components.Parent.entity"]);

        const target = newWorld(platform);
        const loaded = deserializeInto(target, registry, saved.document);
        expect(loaded.report.droppedComponents).toEqual(["entities[0].components.Parent"]);
        expect(target.entityManager.hasComponent(loaded.entities[0], Parent)).toBe(false);
        expect(target.entityManager.hasComponent(loaded.entities[0], LocalPosition)).toBe(true);
    });

    test("a reference to an id the document lacks loads as dangling", () => {
        const document = parseSceneDocument({
            format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [
                {id: 1, name: "lost", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3]}, Parent: {entity: MISSING_SCENE_ID}}},
            ],
        });
        const world = newWorld(memoryPlatform());
        const loaded = deserializeInto(world, engineRegistry(), document);
        expect(loaded.report.danglingEntityRefs).toEqual(["entities[0].components.Parent.entity"]);
        expect(loaded.report.droppedComponents).toEqual(["entities[0].components.Parent"]);
        expect(world.entityManager.hasComponent(loaded.entities[0], Parent)).toBe(false);
    });

    test("unregistered component types are skipped and reported on save", () => {
        const world = newWorld(memoryPlatform());
        const em = world.entityManager;
        em.createEntity("tagged", [new LocalPosition(1, 1, 1), new GameTag()]);
        em.createEntity("alsoTagged", [new GameTag()]);
        em.createEntity();
        const saved = serializeWorld(world, engineRegistry());
        expect(saved.document.entities).toEqual([
            {id: 1, name: "tagged", enabled: true, components: {LocalPosition: {xyz: [1, 1, 1]}}},
            {id: 2, name: "alsoTagged", enabled: true, components: {}},
            {id: 3, name: null, enabled: true, components: {}},
        ]);
        expect(saved.report.skippedComponentTypes).toEqual([{typeName: "GameTag", entityCount: 2}]);
    });

    test("unknown component types throw before touching the world, or are skipped and reported", () => {
        const document = parseSceneDocument(JSON.stringify({
            format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [
                {id: 1, name: "first", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3]}}},
                {id: 2, name: "second", enabled: true, components: {Mystery: {power: 9}, LocalScale: {xyz: [2, 2, 2]}}},
            ],
        }));
        const registry = engineRegistry();
        const strict = newWorld(memoryPlatform());
        expect(() => deserializeInto(strict, registry, document)).toThrow(`entities[1].components.Mystery: the component type "Mystery" is not registered`);
        expect(strict.enabledEntityCount).toBe(0);

        const lenient = newWorld(memoryPlatform());
        const loaded = deserializeInto(lenient, registry, document, {unknownComponentTypes: "skip"});
        expect(loaded.report.skippedComponentTypes).toEqual([{typeName: "Mystery", entityCount: 1}]);
        expect(Vec.toArray(lenient.entityManager.getComponent<LocalScale>(loaded.entities[1], LocalScale)!.xyz)).toEqual([2, 2, 2]);
    });

    test("another backend's types are skipped silently under the throwing policy; an unknown type names the keep list as the fix", () => {
        const document = parseSceneDocument(JSON.stringify({
            format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [
                {id: 1, name: "settings", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3]}, SpriteCellPassSettings: {maxDepthFade: 3}}},
            ],
        }));
        const registry = engineRegistry();
        registry.registerOtherBackendTypeNames(["SpriteCellPassSettings"]);
        const world = newWorld(memoryPlatform());
        const loaded = deserializeInto(world, registry, document);
        expect(loaded.report.skippedComponentTypes).toEqual([]);
        expect(Vec.toArray(world.entityManager.getComponent<LocalPosition>(loaded.entities[0], LocalPosition)!.xyz)).toEqual([1, 2, 3]);
        expect(() => deserializeInto(newWorld(memoryPlatform()), engineRegistry(), document))
            .toThrow(`the component type "SpriteCellPassSettings" is not registered: register its schema, or, if only code names it, add "SpriteCellPassSettings" to "keep" in jsengine.project.json`);
    });

    test("bad field values and unknown fields throw naming the path, before touching the world", () => {
        const registry = engineRegistry();
        const world = newWorld(memoryPlatform());
        const badValue = parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [
            {id: 1, name: "a", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3]}}},
            {id: 2, name: "b", enabled: true, components: {Camera: {nearPlaneDistance: "near"}}},
        ]});
        expect(() => deserializeInto(world, registry, badValue)).toThrow("Scene field entities[1].components.Camera.nearPlaneDistance: expected a number");
        const unknownField = parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [
            {id: 1, name: "a", enabled: true, components: {LocalPosition: {xyz: [1, 2, 3], w: 1}}},
        ]});
        expect(() => deserializeInto(world, registry, unknownField)).toThrow(`entities[0].components.LocalPosition: LocalPosition has no field "w"`);
        expect(world.enabledEntityCount).toBe(0);
    });

    test("parseSceneDocument rejects newer versions and malformed documents", () => {
        expect(() => parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: UNSUPPORTED_VERSION, entities: []}))
            .toThrow(`version ${UNSUPPORTED_VERSION} is newer than the supported version ${SCENE_DOCUMENT_VERSION}`);
        expect(() => parseSceneDocument({format: "other", version: SCENE_DOCUMENT_VERSION, entities: []})).toThrow(`format must be "jsengine-scene"`);
        expect(() => parseSceneDocument(JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [{id: 1}, {id: 1}]})))
            .toThrow("entities[1].id 1 repeats the id of entities[0]");
        expect(() => parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [{id: 0}]})).toThrow("entities[0].id must be a whole number >= 1");
        expect(parseSceneDocument({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [{id: 4}]}).entities)
            .toEqual([{id: 4, name: null, enabled: true, components: {}}]);
    });

    test("applySceneInPlace restores values, re-adds removed components, destroys extra entities and recreates destroyed ones", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const world = newWorld(platform);
        const built = buildEveryComponentWorld(world, platform);
        stepTimes(world, SETTLE_STEPS);
        const snapshot = serializeWorld(world, registry);
        const em = world.entityManager;

        em.getComponent<LocalPosition>(built.root, LocalPosition)!.xyz = Vec3.alloc(0, 0, 0);
        em.getComponent<TextSprite>(built.hud, TextSprite)!.image = ["changed"];
        em.getComponent<LocalRotation>(built.sun, LocalRotation)!.xyzw = Vec4.alloc(0, 0, 0, 1);
        em.removeComponent(built.child, Sprite);
        em.addComponent(built.child, new GameTag());
        em.addComponent(built.hud, new LocalPosition(4, 4, 4));
        const bullet = em.createEntity("bullet", [new LocalPosition(), new LocalToWorld(), new Parent(built.root)]);
        em.setEnabledState(built.asleep, ENABLED);
        em.setEnabledState(built.sun, DISABLED);
        stepTimes(world, SETTLE_STEPS);
        expect(em.getComponent<Children>(built.root, Children)!.has(bullet)).toBe(true);
        em.destroyEntity(built.meshHolder);

        const result = applySceneInPlace(world, registry, snapshot, {assets: platformSceneAssetLoader(platform)});
        expect(result.report).toEqual(EMPTY_LOAD_REPORT);

        expect(em.exists(bullet)).toBe(false);
        expect(em.getComponent<Children>(built.root, Children)!.has(bullet)).toBe(false);
        expect(Vec.toArray(em.getComponent<LocalPosition>(built.root, LocalPosition)!.xyz)).toEqual([10, -2, 3]);
        expect(em.getComponent<TextSprite>(built.hud, TextSprite)!.image).toEqual(["hi", "there"]);
        expect(em.hasComponent(built.hud, LocalPosition)).toBe(false);
        expect(em.getComponent<Sprite>(built.child, Sprite)!.tint).toBe(0x123456);
        expect(em.hasComponent(built.child, GameTag)).toBe(true);
        expect(em.isEnabled(built.asleep)).toBe(false);
        expect(em.isEnabled(built.sun)).toBe(true);

        const meshIndex = recordIndexNamed(snapshot.document, "meshHolder");
        const recreated = result.entities[meshIndex];
        expect(recreated === built.meshHolder).toBe(false);
        expect(em.nameOf(recreated)).toBe("meshHolder");
        expect(em.getComponent<RenderMesh>(recreated, RenderMesh)!.mesh!.sourcePath).toBe(MESH_PATH);
        expect(em.getComponent<Parent>(built.moon, Parent)!.entity).toBe(recreated);
        expect(result.entities.filter((entity, index) => index !== meshIndex && entity !== snapshot.entities[index])).toEqual([]);

        stepTimes(world, SETTLE_STEPS);
        expect(em.getComponent<Children>(recreated, Children)!.children).toEqual([built.moon]);
        expect(matrixOf(world, built.moon)[TRANSLATION_COLUMN + 1]).toBeCloseTo(1, MATRIX_DIGITS);
        expect(matrixOf(world, built.moon)[TRANSLATION_COLUMN + 2]).toBeCloseTo(5, MATRIX_DIGITS);

        const restored = serializeWorld(world, registry);
        expect(restored.report.skippedComponentTypes).toEqual([{typeName: "GameTag", entityCount: 1}]);
        expect(withNamedReferences(restored.document)).toEqual(withNamedReferences(snapshot.document));
    });

    test("applySceneInPlace leaves unchanged components unwritten", () => {
        const platform = memoryPlatform();
        const registry = engineRegistry();
        const world = newWorld(platform);
        const built = buildEveryComponentWorld(world, platform);
        const snapshot = serializeWorld(world, registry);
        const mesh = world.entityManager.getComponent<RenderMesh>(built.meshHolder, RenderMesh)!.mesh;
        const image = world.entityManager.getComponent<Sprite>(built.child, Sprite)!.image;
        let meshLoads = 0;
        const countingLoader = platformSceneAssetLoader(platform);
        const assets: SceneAssetLoader = {
            ...countingLoader,
            loadCached<A>(kind: string, path: string, load: () => A): A {
                if (kind === MESH_ASSET_TYPE_NAME) meshLoads++;
                return countingLoader.loadCached(kind, path, load);
            },
        };
        applySceneInPlace(world, registry, snapshot, {assets});
        expect(meshLoads).toBe(0);
        expect(world.entityManager.getComponent<RenderMesh>(built.meshHolder, RenderMesh)!.mesh).toBe(mesh);
        expect(world.entityManager.getComponent<Sprite>(built.child, Sprite)!.image).toBe(image);
    });

    test("applySceneInPlace needs one live entity per document entity", () => {
        const world = newWorld(memoryPlatform());
        const snapshot = serializeWorld(world, engineRegistry());
        expect(() => applySceneInPlace(world, engineRegistry(), {document: snapshot.document, entities: [world.entityManager.createEntity()]}))
            .toThrow("the snapshot lists 1 entities for 0 document entities");
    });
});
