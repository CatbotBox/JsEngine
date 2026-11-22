import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {System} from "../../engine/core";
import type {Entity, World} from "../../engine/core";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {HudElement} from "../../engine/rendering/hudElement";
import {WorldSpaceRenderBounds} from "../../engine/rendering/worldSpaceRenderBounds";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {EditorOnly, parseSceneDocument} from "../../engine/scene";
import {ask, disposeEditorWorlds, editorWorld, failureOf, fieldsOf, framesPass} from "./editorServiceTestHarness";
import type {Harnessed} from "./editorServiceTestHarness";
import {projectToScreen, rayBoxDistance, screenRay} from "./viewMath";
import type {Mat4} from "./viewMath";

const SCREEN_WIDTH = 20;
const SCREEN_HEIGHT = 10;
const DISABLED = false;
const QUARTER_TURN_RADIANS = Math.PI / 2;
const PROJECTION_DIGITS = 6;
const CAMERA_DISTANCE = 10;

class CameraProbeSystem extends System {
    public renderedCameras: Entity[][] = [];
    private cameras = this.createEntityQuery([Camera]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    public onUpdate(): void {
        const seen: Entity[] = [];
        for (const archetype of this.cameras.archetypes) {
            for (let row = 0; row < archetype.enabledEntityCount; row++) seen.push(archetype.getEntityAtIndex(row));
        }
        this.renderedCameras.push(seen);
    }

    public lastRendered(): readonly Entity[] {
        return this.renderedCameras[this.renderedCameras.length - 1] ?? [];
    }
}

afterEach(disposeEditorWorlds);

function sizedScreen(): ScreenSize {
    const size = new ScreenSize();
    size.x = SCREEN_WIDTH;
    size.y = SCREEN_HEIGHT;
    return size;
}

function bounds(xMin: number, yMin: number, zMin: number, xMax: number, yMax: number, zMax: number): WorldSpaceRenderBounds {
    const box = new WorldSpaceRenderBounds();
    box.xMin = xMin;
    box.yMin = yMin;
    box.zMin = zMin;
    box.xMax = xMax;
    box.yMax = yMax;
    box.zMax = zMax;
    return box;
}

interface Scene2d {
    camera: Entity;
    small: Entity;
    large: Entity;
}

function scene2d(world: World, scene: Scene2d): void {
    const em = world.entityManager;
    world.getOrCreateSystem(CameraProbeSystem);
    scene.camera = em.createEntity("gameCamera", [new Camera(), new LocalPosition(0, 0, 0), new LocalToWorld(), sizedScreen()]);
    scene.small = em.createEntity("small", [new LocalPosition(0, 0, 0), new LocalToWorld(), bounds(-2, -2, 0, 2, 2, 0)]);
    scene.large = em.createEntity("large", [new LocalPosition(0, 0, 1), new LocalToWorld(), bounds(0, 0, 1, 4, 4, 1)]);
    em.createEntity("hud", [new HudElement(), bounds(-100, -100, -1, 100, 100, -1)]);
    const hidden = em.createEntity("hidden", [new LocalPosition(0, 0, -5), new LocalToWorld(), bounds(-100, -100, -5, 100, 100, -5)]);
    em.setEnabledState(hidden, DISABLED);
}

function probeOf(harnessed: Harnessed): CameraProbeSystem {
    return harnessed.world.getOrCreateSystem(CameraProbeSystem);
}

function rounded(values: readonly number[]): number[] {
    return values.map(value => Number(value.toFixed(PROJECTION_DIGITS)) + 0);
}

describe("editor views", () => {
    test("the scene view renders an editor-only camera made from the game camera; requests and saves see the game camera", async () => {
        const scene = {} as Scene2d;
        const harnessed = editorWorld(world => scene2d(world, scene));
        const probe = probeOf(harnessed);
        expect(await framesPass(harnessed)).toBe(true);
        const editorCamera = probe.lastRendered()[0];
        expect(probe.lastRendered().length).toBe(1);
        expect(editorCamera === scene.camera).toBe(false);
        expect(harnessed.world.entityManager.hasComponent(editorCamera, EditorOnly)).toBe(true);
        expect(harnessed.world.entityManager.hasComponent(scene.camera, Camera)).toBe(false);

        const listed = (await ask(harnessed, {op: "listEntities"})).entities;
        expect(listed.some(entity => entity.entity === editorCamera)).toBe(false);
        expect(listed.find(entity => entity.entity === scene.camera)?.componentTypeNames.includes("Camera")).toBe(true);
        expect(await failureOf(ask(harnessed, {op: "getEntity", entity: editorCamera}))).toBe(`Editor request "getEntity" failed: No entity ${editorCamera} in this world`);
        const saved = parseSceneDocument((await ask(harnessed, {op: "saveScene"})).sceneText);
        expect(saved.entities.find(record => record.name === "gameCamera")?.components.Camera).toBeDefined();
        expect(saved.entities.some(record => record.name === "Editor Camera")).toBe(false);

        expect(await ask(harnessed, {op: "setView", view: "game"})).toEqual({view: "game"});
        expect(await framesPass(harnessed)).toBe(true);
        expect(probe.lastRendered()).toEqual([scene.camera]);
    });

    test("play shows the game view, refuses the scene view, and stop returns to the scene view", async () => {
        const scene = {} as Scene2d;
        const harnessed = editorWorld(world => scene2d(world, scene));
        const probe = probeOf(harnessed);
        expect(await framesPass(harnessed)).toBe(true);
        expect((await ask(harnessed, {op: "setMode", mode: "play"})).view).toBe("game");
        expect(await framesPass(harnessed)).toBe(true);
        expect(probe.lastRendered()).toEqual([scene.camera]);
        expect(await failureOf(ask(harnessed, {op: "setView", view: "scene"})))
            .toBe('Editor request "setView" failed: The Scene view is not available while the game plays; pause first');
        expect((await ask(harnessed, {op: "setMode", mode: "paused"})).view).toBe("game");
        expect(await ask(harnessed, {op: "setView", view: "scene"})).toEqual({view: "scene"});
        expect((await ask(harnessed, {op: "setMode", mode: "edit"})).view).toBe("scene");
        expect(await framesPass(harnessed)).toBe(true);
        expect(probe.lastRendered().includes(scene.camera)).toBe(false);
    });

    test("setEditorCamera moves only the editor camera and getViewInfo reports it", async () => {
        const scene = {} as Scene2d;
        const harnessed = editorWorld(world => scene2d(world, scene));
        expect(await framesPass(harnessed)).toBe(true);
        const info = await ask(harnessed, {op: "setEditorCamera", position: [5, 1, 0], rotation: [0, 0, 0, 1]});
        expect(info.camera).toEqual({position: [5, 1, 0], rotation: [0, 0, 0, 1]});
        expect(fieldsOf(await ask(harnessed, {op: "getEntity", entity: scene.camera}), "LocalPosition")).toEqual({xyz: [0, 0, 0]});
        expect((await ask(harnessed, {op: "getViewInfo", view: "game"})).camera.position).toEqual([0, 0, 0]);
        expect(await failureOf(ask(harnessed, {op: "setEditorCamera", position: [0, 0, 0], rotation: [0, 0, 0, 1], fieldOfViewDegrees: 60})))
            .toBe('Editor request "setEditorCamera" failed: The editor camera is orthographic (the game camera has no FieldOfView), so it takes no field of view');
    });

    test("2D view info maps world to screen units around the camera, with bounds or a degenerate box per entity", async () => {
        const scene = {} as Scene2d;
        const harnessed = editorWorld(world => scene2d(world, scene));
        expect(await framesPass(harnessed)).toBe(true);
        await ask(harnessed, {op: "setField", entity: scene.camera, typeName: "LocalPosition", key: "xyz", value: [2, 1, 0]});
        const info = await ask(harnessed, {op: "getViewInfo", view: "game", entities: [scene.small, scene.camera, 999 as Entity]});
        expect([info.projection, info.screenWidth, info.screenHeight]).toEqual(["orthographic", SCREEN_WIDTH, SCREEN_HEIGHT]);
        const projected = projectToScreen(info.worldToScreen as Mat4, [3, 2, 7]);
        expect(rounded([projected.x, projected.y, projected.w])).toEqual([11, 6, 1]);
        expect(info.bounds).toEqual([
            {entity: scene.small, min: [-2, -2, 0], max: [2, 2, 0], pivot: [0, 0, 0], rotation: [0, 0, 0, 1]},
            {entity: scene.camera, min: [2, 1, 0], max: [2, 1, 0], pivot: [2, 1, 0], rotation: [0, 0, 0, 1]},
        ]);
    });

    test("view info reports each entity's world pivot and world rotation through its parents", async () => {
        const scene = {} as Scene2d;
        const harnessed = editorWorld(world => scene2d(world, scene));
        expect(await framesPass(harnessed)).toBe(true);
        const quarterTurn: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
        const parent = await ask(harnessed, {op: "createEntity", name: "parent", components: {LocalPosition: {xyz: [10, 0, 0]}, LocalRotation: {xyzw: quarterTurn}}});
        const child = await ask(harnessed, {op: "createEntity", name: "child", parent: parent.entity, components: {LocalPosition: {xyz: [1, 0, 0]}}});
        const info = await ask(harnessed, {op: "getViewInfo", view: "game", entities: [child.entity]});
        const [placed] = info.bounds;
        expect(rounded(placed.pivot)).toEqual([10, 1, 0]);
        expect(rounded(placed.rotation)).toEqual(rounded(quarterTurn));
    });

    test("2D picking returns the boxes under the point, nearest z then smallest first, skipping HUD and disabled entities", async () => {
        const scene = {} as Scene2d;
        const harnessed = editorWorld(world => scene2d(world, scene));
        expect(await framesPass(harnessed)).toBe(true);
        const centre = {x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2};
        expect((await ask(harnessed, {op: "pickEntities", x: centre.x + 1, y: centre.y + 1, view: "game"})).entities).toEqual([scene.small, scene.large]);
        expect((await ask(harnessed, {op: "pickEntities", x: centre.x + 3, y: centre.y + 3, view: "game"})).entities).toEqual([scene.large]);
        expect((await ask(harnessed, {op: "pickEntities", x: 0, y: 0, view: "game"})).entities).toEqual([]);
        await ask(harnessed, {op: "setEditorCamera", position: [3, 3, 0], rotation: [0, 0, 0, 1]});
        expect((await ask(harnessed, {op: "pickEntities", x: centre.x, y: centre.y, view: "scene"})).entities).toEqual([scene.large]);
    });
});

interface Scene3d {
    camera: Entity;
    near: Entity;
    far: Entity;
    offAxis: Entity;
}

function scene3d(world: World, scene: Scene3d): void {
    const em = world.entityManager;
    const fieldOfView = new FieldOfView();
    fieldOfView.radians = QUARTER_TURN_RADIANS;
    scene.camera = em.createEntity("gameCamera", [new Camera(), new LocalPosition(0, 0, -CAMERA_DISTANCE), new LocalToWorld(), sizedScreen(), fieldOfView]);
    scene.near = em.createEntity("near", [new LocalPosition(), new LocalToWorld(), bounds(-1, -1, -1, 1, 1, 1)]);
    scene.far = em.createEntity("far", [new LocalPosition(0, 0, 10), new LocalToWorld(), bounds(-3, -3, 7, 3, 3, 13)]);
    scene.offAxis = em.createEntity("offAxis", [new LocalPosition(8, 0, 0), new LocalToWorld(), bounds(7, -1, -1, 9, 1, 1)]);
}

describe("editor 3D views", () => {
    test("3D view info is a perspective projection in screen units", async () => {
        const scene = {} as Scene3d;
        const harnessed = editorWorld(world => scene3d(world, scene));
        expect(await framesPass(harnessed)).toBe(true);
        const info = await ask(harnessed, {op: "getViewInfo", view: "game"});
        expect(info.projection).toBe("perspective");
        expect(info.camera.fieldOfViewDegrees).toBeCloseTo(90, PROJECTION_DIGITS);
        const matrix = info.worldToScreen as Mat4;
        const centre = projectToScreen(matrix, [0, 0, 0]);
        expect(rounded([centre.x, centre.y, centre.w])).toEqual([10, 5, CAMERA_DISTANCE]);
        const offset = projectToScreen(matrix, [2, 1, 0]);
        expect(rounded([offset.x, offset.y])).toEqual([12, 4.5]);
        const ray = screenRay(cameraMatrixAt(-CAMERA_DISTANCE), QUARTER_TURN_RADIANS, SCREEN_WIDTH, SCREEN_HEIGHT, offset.x, offset.y);
        expect(rayBoxDistance(ray, {min: [1.9, 0.9, -0.1], max: [2.1, 1.1, 0.1]})).toBeDefined();
        expect((await ask(harnessed, {op: "getViewInfo", view: "scene"})).projection).toBe("perspective");
    });

    test("3D picking casts a ray through the point and returns hits nearest first", async () => {
        const scene = {} as Scene3d;
        const harnessed = editorWorld(world => scene3d(world, scene));
        expect(await framesPass(harnessed)).toBe(true);
        const centre = {x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2};
        expect((await ask(harnessed, {op: "pickEntities", ...centre, view: "game"})).entities).toEqual([scene.near, scene.far]);
        const projected = projectToScreen((await ask(harnessed, {op: "getViewInfo", view: "game"})).worldToScreen as Mat4, [8, 0, 0]);
        expect((await ask(harnessed, {op: "pickEntities", x: projected.x, y: projected.y, view: "game"})).entities).toEqual([scene.offAxis]);
        await ask(harnessed, {op: "setEditorCamera", position: [0, 0, 20], rotation: [0, 1, 0, 0], fieldOfViewDegrees: 90});
        expect((await ask(harnessed, {op: "pickEntities", ...centre, view: "scene"})).entities).toEqual([scene.far, scene.near]);
    });
});

describe("editor views before the screen is sized", () => {
    test("picking an unsized 3D view finds nothing instead of matching every box", async () => {
        const scene = {} as Scene3d;
        const harnessed = editorWorld(world => {
            scene3d(world, scene);
            const size = world.entityManager.getComponent<ScreenSize>(scene.camera, ScreenSize)!;
            size.x = 0;
            size.y = 0;
        });
        expect(await framesPass(harnessed)).toBe(true);
        expect((await ask(harnessed, {op: "pickEntities", x: 0, y: 0, view: "game"})).entities).toEqual([]);
        expect((await ask(harnessed, {op: "getViewInfo", view: "game"})).screenWidth).toBe(0);
    });
});

function cameraMatrixAt(z: number): Mat4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, z, 1];
}
