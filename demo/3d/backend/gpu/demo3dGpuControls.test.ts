import {describe, expect, MemoryPlatform, test} from "@jsengine/engine/testing";
import {EntityQuery, World} from "@jsengine/engine/core";
import type {Entity} from "@jsengine/engine/core";
import {Input, inputMapOf, Key, NO_MODIFIERS} from "@jsengine/engine/input";
import {GpuRenderBackend} from "@jsengine/engine/rendering";
import {RenderMesh} from "@jsengine/engine/rendering/3d";
import {LocalPosition} from "@jsengine/engine/translation";
import {GpuMeshPassSettings, GpuPostProcessSettings, GpuShadowSettings, REINHARD_TONE_MAPPING} from "@jsengine/backends/gpu";
import {Demo3dConfig, GroundPlaneConfig} from "../../config";
import {Demo3dGpuControlsSystem} from "./demo3dGpuControlsSystem";
import {Demo3dGroundSystem, GROUND_ENTITY_NAME, groundPlaneMesh} from "./demo3dGroundSystem";

const GROUND_HALF_SIZE = 12;
const GROUND_HEIGHT = -3.5;
const GROUND_COLOR = 0x808070;
const TUNED_STRENGTH = 0.4;
const TUNED_EXPOSURE = 1.6;
const STEPS_FOR_COMMANDS = 2;
const UP: readonly number[] = [0, 1, 0];
const VEC3_FLOATS = 3;
const NOT_REPEATED = false;
const QUAD_TRIANGLES = 2;
const GROUND_PLANE_QUERY = [RenderMesh, LocalPosition] as const;

interface PlacedGround {
    readonly entity: Entity;
    readonly name: string | undefined;
    readonly height: number;
}

function groundConfig(): Demo3dConfig {
    const groundPlane = Object.assign(new GroundPlaneConfig(), {halfSizeUnits: GROUND_HALF_SIZE, heightUnits: GROUND_HEIGHT, color: GROUND_COLOR});
    return Object.assign(new Demo3dConfig(), {groundPlane});
}

function demoWorld(gpuBackend: boolean): World {
    const world = new World({platform: new MemoryPlatform()});
    if (gpuBackend) world.resources.insert(new GpuRenderBackend());
    world.resources.insert(groundConfig());
    world.resources.insert(inputMapOf({
        toggleTextureFiltering: {keys: [Key.M]},
        cycleSurfaceShader: {keys: [Key.O]},
        toggleShadows: {keys: [Key.U]},
        togglePostProcessing: {keys: [Key.C]},
    }));
    return world;
}

function groundsOf(world: World): PlacedGround[] {
    const grounds: PlacedGround[] = [];
    new EntityQuery(world, GROUND_PLANE_QUERY).stream({read: {position: LocalPosition}}, {includeEntity: true}).consume(({entity, position}) => {
        grounds.push({entity, name: world.entityManager.nameOf(entity), height: position.y});
    });
    return grounds;
}

function step(world: World, times: number = 1): void {
    for (let i = 0; i < times; i++) world.step();
}

function tap(world: World, key: Key): void {
    const input = world.resources.get(Input);
    input.enqueue({type: "keyDown", key, repeat: NOT_REPEATED, ...NO_MODIFIERS});
    step(world, STEPS_FOR_COMMANDS);
    input.enqueue({type: "keyUp", key, ...NO_MODIFIERS});
    step(world);
}

describe("Demo3dGroundSystem", () => {
    test("under the gpu backend one ground plane is placed at the configured height, and placed again if it is destroyed", () => {
        const world = demoWorld(true);
        world.getOrCreateSystem(Demo3dGroundSystem);
        step(world, STEPS_FOR_COMMANDS);
        const [ground, ...others] = groundsOf(world);
        expect(others).toEqual([]);
        expect([ground.name, ground.height]).toEqual([GROUND_ENTITY_NAME, GROUND_HEIGHT]);
        world.entityManager.destroyEntity(ground.entity);
        step(world);
        expect(groundsOf(world).map(placed => placed.height)).toEqual([GROUND_HEIGHT]);
    });

    test("without the gpu backend no ground plane is placed, so the cells and pixels scenes are unchanged", () => {
        const world = demoWorld(false);
        world.getOrCreateSystem(Demo3dGroundSystem);
        step(world, STEPS_FOR_COMMANDS);
        expect(groundsOf(world)).toEqual([]);
    });

    test("the ground mesh is a square of the configured half size facing up, in the configured colour", () => {
        const mesh = groundPlaneMesh(groundConfig().groundPlane);
        expect(mesh.triangleCount).toBe(QUAD_TRIANGLES);
        const normals = mesh.normals.raw, vertices = mesh.vertices.raw;
        for (let v = 0; v < mesh.vertCount * VEC3_FLOATS; v += VEC3_FLOATS) {
            expect(Array.from(normals.subarray(v, v + VEC3_FLOATS))).toEqual(UP);
            expect([Math.abs(vertices[v]), vertices[v + 1], Math.abs(vertices[v + 2])]).toEqual([GROUND_HALF_SIZE, 0, GROUND_HALF_SIZE]);
        }
        expect(mesh.materials[0].diffuseColor).toBe(GROUND_COLOR);
    });
});

describe("Demo3dGpuControlsSystem shadow toggle", () => {
    test("the shadow key takes GpuShadowSettings off the settings entity, and puts the same tuning back on the next press", () => {
        const world = demoWorld(true);
        const tuning = Object.assign(new GpuShadowSettings(), {strength: TUNED_STRENGTH});
        const settings = world.entityManager.createEntity("settings", [new GpuMeshPassSettings(), tuning]);
        world.getOrCreateSystem(Demo3dGpuControlsSystem);
        step(world);
        tap(world, Key.U);
        expect(world.entityManager.getComponent(settings, GpuShadowSettings)).toBe(undefined);
        expect(world.entityManager.getComponent(settings, GpuMeshPassSettings)).not.toBe(undefined);
        tap(world, Key.U);
        expect(world.entityManager.getComponent<GpuShadowSettings>(settings, GpuShadowSettings)?.strength).toBe(TUNED_STRENGTH);
    });

    test("pressed with no shadow settings anywhere, the key adds default shadow settings to the gpu settings entity", () => {
        const world = demoWorld(true);
        const settings = world.entityManager.createEntity("settings", [new GpuMeshPassSettings()]);
        world.getOrCreateSystem(Demo3dGpuControlsSystem);
        step(world);
        tap(world, Key.U);
        expect(world.entityManager.getComponent<GpuShadowSettings>(settings, GpuShadowSettings)?.mapSize).toBe(new GpuShadowSettings().mapSize);
    });
});

describe("Demo3dGpuControlsSystem post-processing toggle", () => {
    test("the post-processing key takes GpuPostProcessSettings off the settings entity, and puts the same tuning back on the next press", () => {
        const world = demoWorld(true);
        const tuning = Object.assign(new GpuPostProcessSettings(), {exposure: TUNED_EXPOSURE, toneMapping: REINHARD_TONE_MAPPING});
        const settings = world.entityManager.createEntity("settings", [new GpuMeshPassSettings(), new GpuShadowSettings(), tuning]);
        world.getOrCreateSystem(Demo3dGpuControlsSystem);
        step(world);
        tap(world, Key.C);
        expect(world.entityManager.getComponent(settings, GpuPostProcessSettings)).toBe(undefined);
        expect(world.entityManager.getComponent(settings, GpuShadowSettings)).not.toBe(undefined);
        tap(world, Key.C);
        const restored = world.entityManager.getComponent<GpuPostProcessSettings>(settings, GpuPostProcessSettings);
        expect([restored?.exposure, restored?.toneMapping]).toEqual([TUNED_EXPOSURE, REINHARD_TONE_MAPPING]);
    });

    test("pressed with no post-processing settings anywhere, the key adds default settings to the gpu settings entity", () => {
        const world = demoWorld(true);
        const settings = world.entityManager.createEntity("settings", [new GpuMeshPassSettings()]);
        world.getOrCreateSystem(Demo3dGpuControlsSystem);
        step(world);
        tap(world, Key.C);
        expect(world.entityManager.getComponent<GpuPostProcessSettings>(settings, GpuPostProcessSettings)?.bloomMipLevels).toBe(new GpuPostProcessSettings().bloomMipLevels);
        expect(world.entityManager.getComponent(settings, GpuShadowSettings)).toBe(undefined);
    });
});
