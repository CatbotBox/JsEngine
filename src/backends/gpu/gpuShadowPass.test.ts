import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {DebugWorld, World} from "../../engine/core";
import type {Component, Entity} from "../../engine/core";
import {Vec} from "../../engine/math/types/vec";
import {Quaternions} from "../../engine/math/quaternions";
import {Camera} from "../../engine/rendering/camera";
import {Mesh, MeshBuilder} from "../../engine/rendering/3d/mesh";
import {Material} from "../../engine/rendering/3d/material";
import {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {MeshRenderSettings} from "../../engine/rendering/3d/meshRenderSettings";
import {MeshRenderStats} from "../../engine/rendering/3d/meshRenderStats";
import {DirectionalLight} from "../../engine/rendering/3d/lighting/directionalLight";
import {PointLight} from "../../engine/rendering/3d/lighting/pointLight";
import {SpotLight} from "../../engine/rendering/3d/lighting/spotLight";
import {RectAreaLight} from "../../engine/rendering/3d/lighting/rectAreaLight";
import {LocalPosition, LocalRotation, LocalToWorld} from "../../engine/translation";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {GpuFrame} from "./gpuFrame";
import {GpuCanvasPixelPresenter} from "./gpuCanvasPixelPresenter";
import {GpuMeshPassSystem} from "./gpuMeshPassSystem";
import {GpuMeshPassSettings} from "./gpuMeshPassSettings";
import {LIGHT_SHADOW_MAP_OFFSET, LIGHT_STRIDE_FLOATS, LIGHTS_HEADER_FLOATS, NO_SHADOW_MAP_SLOT} from "./gpuLightPacking";
import {GpuShadowSettings, MIN_SHADOW_MAP_SIZE} from "./gpuShadowSettings";
import {
    NO_SHADOWED_LIGHT,
    SHADOW_MAP_LAYER_OFFSET,
    SHADOW_MAP_PROJECTION_OFFSET,
    SHADOW_MAP_STRIDE_FLOATS,
    SHADOW_PROJECTION_CUBE,
    SHADOW_PROJECTION_ORTHOGRAPHIC,
    SHADOW_PROJECTION_PERSPECTIVE,
    SHADOWS_HEADER_FLOATS,
    SHADOWS_MAP_COUNT_OFFSET,
    SHADOWS_PRIMARY_LIGHT_OFFSET,
} from "./gpuShadowPacking";
import {
    DIRECTIONAL_SHADOW_MAPS_LABEL,
    NO_SHADOW_MAP_LABEL,
    POINT_SHADOW_MAPS_LABEL,
    SHADOW_CASTER_UNIFORMS_LABEL,
    SHADOW_INSTANCES_LABEL,
    SHADOW_PASS_LABEL,
    SHADOWS_LABEL,
    SPOT_SHADOW_EDGE_MARGIN_TEXELS,
    SPOT_SHADOW_MAPS_LABEL,
    SPOT_SHADOW_MAX_HALF_ANGLE,
    SPOT_SHADOW_MIN_HALF_ANGLE,
    spotShadowTanHalfAngleOf,
} from "./gpuShadowPass";
import {SHADOW_CASTER_CULL_MODE, SHADOW_MAP_FORMAT} from "./gpuShadowPipelineCache";
import {SHADOW_CASTER_SHADER_NAME, SHADOW_CASTER_UNIFORM_STRIDE_BYTES} from "./shaders/shadowCasterShader";
import {DIRECTIONAL_SHADOW_MAPS_BINDING, FRAME_BIND_GROUP, POINT_SHADOW_MAPS_BINDING, SHADOWS_BINDING, SPOT_SHADOW_MAPS_BINDING} from "./shaders/basicLitShader";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "./testing/fakeGpuDevice";
import type {FakeGpuBuffer, FakeGpuTexture, FakeGpuTextureView, FakeRenderPass} from "./testing/fakeGpuDevice";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SIZE = {widthPx: 64, heightPx: 48};
const SETTLE_STEPS = 3;
const MORE_STEPS = 4;
const QUAD_TRIANGLES = 2;
const TRIANGLE_CORNERS = 3;
const IN_FRONT_Z = 4;
const BEHIND_CAMERA_Z = -4;
const FAR_TO_THE_SIDE_X = 500;
const MAP_SIZE = 256;
const OTHER_MAP_SIZE = 512;
const SPOT_MAP_SIZE = 128;
const POINT_MAP_SIZE = 64;
const SLOPE_BIAS = 2;
const OTHER_SLOPE_BIAS = 3;
const EVICT_AFTER_FRAMES = 3;
const PLACEHOLDER_SIZE = 1;
const CUBE_FACES = 6;
const LOD_GRID_CELLS = [32, 16, 8, 2];
const GRID_HALF_SIZE = 1;
const NO_STRENGTH = 0;
const NO_MAP = 0;
const DOWNWARD_TILT_RAD = 0.6;
const NO_TURN_RAD = 0;
const LIGHT_RANGE = 20;
const LAMP_Z = 2;
const FIRST_RECORD = 0;
const SECOND_RECORD = 1;
const THIRD_RECORD = 2;
const POSITIVE_Z_FACE = 4;
const NEGATIVE_Z_FACE = 5;
const BUDGET_OF_TWO = 2;
const ONE_CUBE = 1;
const CASTS = true;
const SPOT_OUTER_CONE = 0.5;
const DIGITS = 6;
const SHADOW_TEXTURE_LABELS = [NO_SHADOW_MAP_LABEL, DIRECTIONAL_SHADOW_MAPS_LABEL, SPOT_SHADOW_MAPS_LABEL, POINT_SHADOW_MAPS_LABEL];

interface ShadowRig {
    readonly world: World;
    readonly device: FakeGpuDevice;
    readonly errors: unknown[];
    readonly settings: GpuMeshPassSettings;
}

function ignore(): void {
}

function quad(material: Material = new Material("flat", 0x336699)): Mesh {
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(-1, -1, 0), Vec.alloc3(1, -1, 0), Vec.alloc3(1, 1, 0), Vec.alloc3(-1, 1, 0));
    builder.uvs.push(Vec.alloc2(0, 0), Vec.alloc2(1, 0), Vec.alloc2(1, 1), Vec.alloc2(0, 1));
    builder.triangles.push(Vec.alloc3(0, 2, 1), Vec.alloc3(0, 3, 2));
    builder.materials.push(material);
    builder.vertexMaterial.push(0, 0, 0, 0);
    builder.generateNormals();
    return new Mesh(builder);
}

function grid(cellsPerSide: number, material: Material): Mesh {
    const builder = new MeshBuilder();
    const step = GRID_HALF_SIZE * 2 / cellsPerSide;
    const row = cellsPerSide + 1;
    for (let y = 0; y <= cellsPerSide; y++) {
        for (let x = 0; x <= cellsPerSide; x++) {
            builder.vertices.push(Vec.alloc3(x * step - GRID_HALF_SIZE, y * step - GRID_HALF_SIZE, 0));
            builder.uvs.push(Vec.alloc2(x / cellsPerSide, y / cellsPerSide));
        }
    }
    for (let y = 0; y < cellsPerSide; y++) {
        for (let x = 0; x < cellsPerSide; x++) {
            const corner = y * row + x;
            builder.triangles.push(Vec.alloc3(corner, corner + row + 1, corner + 1), Vec.alloc3(corner, corner + row, corner + row + 1));
        }
    }
    builder.materials.push(material);
    builder.generateNormals();
    return new Mesh(builder);
}

function meshWithLods(): Mesh {
    const material = new Material("grid", 0x669933);
    const [finest, ...coarser] = LOD_GRID_CELLS.map(cells => grid(cells, material));
    finest.attachLods(coarser);
    return finest;
}

function shadowRig(debug: boolean = true): ShadowRig {
    const world = debug ? new DebugWorld({platform: new MemoryPlatform()}) : new World({platform: new MemoryPlatform()});
    const errors: unknown[] = [];
    world.onStopped.add(event => errors.push(event.error));
    const device = new FakeGpuDevice();
    const canvas = new FakeCanvas();
    const gpu = new GpuDeviceResource(device, new GpuFrame(device, new FakeCanvasContext(canvas, FORMAT), canvas, FORMAT));
    world.resources.insert(gpu);
    world.resources.insert(new PixelPresenterResource(new GpuCanvasPixelPresenter(new MemoryPixelPresenter(SIZE), gpu, ignore)));
    world.entityManager.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    const settings = Object.assign(new GpuMeshPassSettings(), {evictUnusedAfterFrames: EVICT_AFTER_FRAMES});
    world.entityManager.createEntity("gpu settings", [settings]);
    world.getOrCreateSystem(GpuMeshPassSystem);
    return {world, device, errors, settings};
}

function addSun(world: World, pitchRad: number = NO_TURN_RAD): DirectionalLight {
    const rotation = Quaternions.eulerToQuat(Vec.alloc3(pitchRad, NO_TURN_RAD, NO_TURN_RAD));
    const sun = new DirectionalLight();
    world.entityManager.createEntity("sun", [sun, new LocalRotation(Vec.x(rotation), Vec.y(rotation), Vec.z(rotation), Vec.w(rotation)), new LocalToWorld()]);
    return sun;
}

function addLight<T extends Component & {castsShadows: boolean}>(world: World, light: T, z: number, castsShadows: boolean = CASTS): Entity {
    light.castsShadows = castsShadows;
    return world.entityManager.createEntity("light", [light, new LocalPosition(0, 0, z), new LocalToWorld()]);
}

function addSpot(world: World): Entity {
    return addLight(world, new SpotLight(LIGHT_RANGE), 0);
}

function addLamp(world: World, z: number = LAMP_Z, castsShadows: boolean = CASTS): Entity {
    return addLight(world, new PointLight(LIGHT_RANGE), z, castsShadows);
}

interface AddedShadowSettings {
    readonly entity: Entity;
    readonly shadows: GpuShadowSettings;
}

function addShadowSettings(world: World, overrides: Partial<GpuShadowSettings> = {}): AddedShadowSettings {
    const shadows = Object.assign(new GpuShadowSettings(), {mapSize: MAP_SIZE, spotMapSize: SPOT_MAP_SIZE, pointMapSize: POINT_MAP_SIZE, slopeBias: SLOPE_BIAS}, overrides);
    return {entity: world.entityManager.createEntity("shadow settings", [shadows]), shadows};
}

function addQuadAt(world: World, mesh: Mesh, x: number, z: number): void {
    world.entityManager.createEntity("quad", [new RenderMesh(mesh), new LocalToWorld(), new LocalPosition(x, 0, z)]);
}

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

async function step({world, device}: ShadowRig, times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
        world.step();
        device.queue.completeSubmittedWork();
        await nextTask();
    }
}

function passesLabelled(device: FakeGpuDevice, label: string): FakeRenderPass[] {
    return device.submittedPasses.filter(pass => pass.descriptor.label === label);
}

function lastPass(device: FakeGpuDevice, label: string): FakeRenderPass | undefined {
    return passesLabelled(device, label).at(-1);
}

function lastShadowSubmission(device: FakeGpuDevice): FakeRenderPass[] {
    const submission = device.queue.submissions.filter(buffers => buffers.some(buffer => buffer.passes.some(pass => pass.descriptor.label === SHADOW_PASS_LABEL))).at(-1);
    return submission === undefined ? [] : submission.flatMap(buffer => [...buffer.passes]);
}

function instancesDrawn(pass: FakeRenderPass): number {
    return pass.callsOf("drawIndexed").reduce((sum, call) => sum + (call.args[1] as number), 0);
}

function renderedView(pass: FakeRenderPass): FakeGpuTextureView {
    return pass.descriptor.depthStencilAttachment!.view as unknown as FakeGpuTextureView;
}

function boundFrameEntry(device: FakeGpuDevice, binding: number): unknown {
    const frameBindings = lastPass(device, "scene")!.callsOf("setBindGroup").filter(call => call.args[0] === FRAME_BIND_GROUP);
    const bindGroup = frameBindings.at(-1)!.args[1] as GPUBindGroupDescriptor;
    return [...bindGroup.entries].find(entry => entry.binding === binding)!.resource;
}

function boundView(device: FakeGpuDevice, binding: number): FakeGpuTextureView {
    return boundFrameEntry(device, binding) as unknown as FakeGpuTextureView;
}

function lastWriteTo(device: FakeGpuDevice, label: string): Float32Array {
    const data = device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === label).at(-1)!.data as Float32Array;
    return new Float32Array(data.buffer, data.byteOffset, data.length);
}

function lastShadowWords(device: FakeGpuDevice): Uint32Array {
    const data = lastWriteTo(device, SHADOWS_LABEL);
    return new Uint32Array(data.buffer, data.byteOffset, data.length);
}

function recordOf(words: Uint32Array, record: number): [number, number] {
    const o = SHADOWS_HEADER_FLOATS + record * SHADOW_MAP_STRIDE_FLOATS;
    return [words[o + SHADOW_MAP_PROJECTION_OFFSET], words[o + SHADOW_MAP_LAYER_OFFSET]];
}

function lightShadowSlots(device: FakeGpuDevice, lights: number): number[] {
    const data = lastWriteTo(device, "scene lights");
    return Array.from({length: lights}, (_, light) => data[LIGHTS_HEADER_FLOATS + light * LIGHT_STRIDE_FLOATS + LIGHT_SHADOW_MAP_OFFSET]);
}

function texturesLabelled(device: FakeGpuDevice, label: string): FakeGpuTexture[] {
    return device.textures.filter(texture => texture.descriptor.label === label);
}

function shadowPipelines(device: FakeGpuDevice): GPURenderPipelineDescriptor[] {
    return device.pipelines.filter(pipeline => pipeline.label?.startsWith(`${SHADOW_CASTER_SHADER_NAME}|`));
}

function submissionIndexOf(device: FakeGpuDevice, pass: FakeRenderPass): number {
    return device.queue.submissions.findIndex(buffers => buffers.some(buffer => buffer.passes.includes(pass)));
}

function liveBufferLabels(device: FakeGpuDevice): string[] {
    return device.liveBuffers().map((buffer: FakeGpuBuffer) => buffer.descriptor.label ?? "").sort();
}

describe("GpuMeshPassSystem shadows", () => {
    test("without GpuShadowSettings there are no shadow passes, maps or instances: one 1x1 placeholder is bound for every map binding and no light has a map", async () => {
        const rig = shadowRig();
        addSun(rig.world);
        addLamp(rig.world);
        addQuadAt(rig.world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        expect(passesLabelled(rig.device, SHADOW_PASS_LABEL)).toEqual([]);
        expect(rig.device.textures.filter(texture => SHADOW_TEXTURE_LABELS.includes(texture.descriptor.label ?? "")).map(texture => texture.descriptor.label)).toEqual([NO_SHADOW_MAP_LABEL]);
        expect(rig.device.buffers.some(buffer => buffer.descriptor.label === SHADOW_INSTANCES_LABEL)).toBe(false);
        const words = lastShadowWords(rig.device);
        expect([words[SHADOWS_PRIMARY_LIGHT_OFFSET], words[SHADOWS_MAP_COUNT_OFFSET]]).toEqual([NO_SHADOWED_LIGHT, 0]);
        expect(rig.device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === SHADOWS_LABEL).length).toBe(1);
        expect(lightShadowSlots(rig.device, 2)).toEqual([NO_SHADOW_MAP_SLOT, NO_SHADOW_MAP_SLOT]);
        const placeholder = boundView(rig.device, DIRECTIONAL_SHADOW_MAPS_BINDING).texture.descriptor;
        expect([placeholder.label, placeholder.size, placeholder.format]).toEqual([NO_SHADOW_MAP_LABEL, {width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE, depthOrArrayLayers: CUBE_FACES}, SHADOW_MAP_FORMAT]);
        expect([DIRECTIONAL_SHADOW_MAPS_BINDING, SPOT_SHADOW_MAPS_BINDING, POINT_SHADOW_MAPS_BINDING].map(binding => boundView(rig.device, binding).descriptor.dimension))
            .toEqual(["2d-array", "2d-array", "cube-array"]);
        expect((boundFrameEntry(rig.device, SHADOWS_BINDING) as {buffer: FakeGpuBuffer}).buffer.descriptor.label).toBe(SHADOWS_LABEL);
        expect(rig.world.resources.get(MeshRenderStats).trianglesDrawn).toBe(QUAD_TRIANGLES);
    });

    test("settings without a casting light, or with no strength or no map size, keep shadows off; a lamp only casts once it opts in", async () => {
        const rig = shadowRig();
        const lamp = addLamp(rig.world, LAMP_Z, false);
        const {shadows} = addShadowSettings(rig.world);
        addQuadAt(rig.world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(passesLabelled(rig.device, SHADOW_PASS_LABEL)).toEqual([]);
        addSun(rig.world);
        shadows.strength = NO_STRENGTH;
        await step(rig, SETTLE_STEPS);
        expect(passesLabelled(rig.device, SHADOW_PASS_LABEL)).toEqual([]);
        Object.assign(shadows, {strength: new GpuShadowSettings().strength, mapSize: NO_MAP});
        await step(rig, SETTLE_STEPS);
        expect(passesLabelled(rig.device, SHADOW_PASS_LABEL)).toEqual([]);
        expect(lastShadowWords(rig.device)[SHADOWS_MAP_COUNT_OFFSET]).toBe(0);
        rig.world.entityManager.getComponent<PointLight>(lamp, PointLight)!.castsShadows = true;
        await step(rig, SETTLE_STEPS);
        expect(lastShadowSubmission(rig.device).length).toBe(CUBE_FACES);
        expect(rig.errors).toEqual([]);
    });

    test("a directional map is a depth-only pass submitted before the scene that draws casters the camera culls, such as one behind it", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addSun(world);
        addShadowSettings(world);
        const mesh = quad();
        addQuadAt(world, mesh, 0, IN_FRONT_Z);
        addQuadAt(world, mesh, 0, BEHIND_CAMERA_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        const scene = lastPass(device, "scene")!, shadow = lastPass(device, SHADOW_PASS_LABEL)!;
        expect(instancesDrawn(scene)).toBe(1);
        expect(shadow.callsOf("drawIndexed").map(call => call.args)).toEqual([[QUAD_TRIANGLES * TRIANGLE_CORNERS, 2, 0, 0, 0]]);
        expect(submissionIndexOf(device, shadow)).toBeLessThan(submissionIndexOf(device, scene));
        expect([...shadow.descriptor.colorAttachments]).toEqual([]);
        const depth = shadow.descriptor.depthStencilAttachment!;
        expect([depth.depthLoadOp, depth.depthStoreOp, depth.depthClearValue]).toEqual(["clear", "store", 1]);
        expect([renderedView(shadow).texture.descriptor.label, renderedView(shadow).descriptor.dimension, renderedView(shadow).descriptor.baseArrayLayer])
            .toEqual([DIRECTIONAL_SHADOW_MAPS_LABEL, "2d", 0]);
        const sampled = boundView(device, DIRECTIONAL_SHADOW_MAPS_BINDING);
        expect([sampled.texture.descriptor.label, sampled.texture.descriptor.size, sampled.descriptor.dimension])
            .toEqual([DIRECTIONAL_SHADOW_MAPS_LABEL, {width: MAP_SIZE, height: MAP_SIZE, depthOrArrayLayers: 1}, "2d-array"]);
        const words = lastShadowWords(device);
        expect([words[SHADOWS_PRIMARY_LIGHT_OFFSET], words[SHADOWS_MAP_COUNT_OFFSET]]).toEqual([0, 1]);
        expect(recordOf(words, FIRST_RECORD)).toEqual([SHADOW_PROJECTION_ORTHOGRAPHIC, 0]);
        expect(lightShadowSlots(device, 1)).toEqual([FIRST_RECORD]);
        const instanceWrites = device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === SHADOW_INSTANCES_LABEL);
        expect(instanceWrites.length).toBe(SETTLE_STEPS);
        expect(world.resources.get(MeshRenderStats).trianglesDrawn).toBe(QUAD_TRIANGLES);
    });

    test("a spot light renders one perspective map into the spot array at its own size", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addSpot(world);
        addShadowSettings(world);
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        const passes = lastShadowSubmission(device);
        expect(passes.length).toBe(1);
        expect(instancesDrawn(passes[0])).toBe(1);
        expect(renderedView(passes[0]).texture.descriptor.label).toBe(SPOT_SHADOW_MAPS_LABEL);
        const sampled = boundView(device, SPOT_SHADOW_MAPS_BINDING);
        expect([sampled.texture.descriptor.size, sampled.descriptor.dimension]).toEqual([{width: SPOT_MAP_SIZE, height: SPOT_MAP_SIZE, depthOrArrayLayers: 1}, "2d-array"]);
        expect(boundView(device, DIRECTIONAL_SHADOW_MAPS_BINDING).texture.descriptor.label).toBe(NO_SHADOW_MAP_LABEL);
        const words = lastShadowWords(device);
        expect([words[SHADOWS_PRIMARY_LIGHT_OFFSET], words[SHADOWS_MAP_COUNT_OFFSET]]).toEqual([NO_SHADOWED_LIGHT, 1]);
        expect(recordOf(words, FIRST_RECORD)).toEqual([SHADOW_PROJECTION_PERSPECTIVE, 0]);
        expect(lightShadowSlots(device, 1)).toEqual([FIRST_RECORD]);
    });

    test("a point light renders six faces into one cube of the cube array, drawing each caster only in the faces that see it", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addLamp(world);
        addShadowSettings(world);
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        addQuadAt(world, quad(), 0, BEHIND_CAMERA_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        const passes = lastShadowSubmission(device);
        expect(passes.map(pass => [renderedView(pass).texture.descriptor.label, renderedView(pass).descriptor.baseArrayLayer]))
            .toEqual(Array.from({length: CUBE_FACES}, (_, face) => [POINT_SHADOW_MAPS_LABEL, face]));
        expect(passes.map(instancesDrawn)).toEqual([0, 0, 0, 0, 1, 1]);
        expect(passes.every(pass => pass.ended && pass.callsOf("setPipeline").length === 1)).toBe(true);
        expect(passes.map(pass => pass.callsOf("setBindGroup")[0].args[3])).toEqual([0, 1, 2, 3, 4, 5]);
        expect((passes[POSITIVE_Z_FACE].callsOf("setBindGroup")[0].args[2] as Uint32Array)[POSITIVE_Z_FACE]).toBe(POSITIVE_Z_FACE * SHADOW_CASTER_UNIFORM_STRIDE_BYTES);
        expect(instancesDrawn(passes[NEGATIVE_Z_FACE])).toBe(1);
        const sampled = boundView(device, POINT_SHADOW_MAPS_BINDING);
        expect([sampled.texture.descriptor.size, sampled.descriptor.dimension, sampled.descriptor.arrayLayerCount])
            .toEqual([{width: POINT_MAP_SIZE, height: POINT_MAP_SIZE, depthOrArrayLayers: CUBE_FACES}, "cube-array", CUBE_FACES]);
        const words = lastShadowWords(device);
        expect(recordOf(words, FIRST_RECORD)).toEqual([SHADOW_PROJECTION_CUBE, 0]);
        expect(lightShadowSlots(device, 1)).toEqual([FIRST_RECORD]);
    });

    test("sun, spot and lamp each get a record, in one encoder of eight passes, and the sun stays the primary shadowed light", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addLamp(world);
        addSpot(world);
        addSun(world);
        addShadowSettings(world);
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        const passes = lastShadowSubmission(device);
        expect(passes.map(pass => renderedView(pass).texture.descriptor.label)).toEqual([
            DIRECTIONAL_SHADOW_MAPS_LABEL, SPOT_SHADOW_MAPS_LABEL, ...new Array(CUBE_FACES).fill(POINT_SHADOW_MAPS_LABEL),
        ]);
        expect(device.queue.submissions.filter(buffers => buffers.some(buffer => buffer.passes.includes(passes[0]))).length).toBe(1);
        const words = lastShadowWords(device);
        expect([words[SHADOWS_PRIMARY_LIGHT_OFFSET], words[SHADOWS_MAP_COUNT_OFFSET]]).toEqual([0, 3]);
        expect([recordOf(words, FIRST_RECORD), recordOf(words, SECOND_RECORD), recordOf(words, THIRD_RECORD)])
            .toEqual([[SHADOW_PROJECTION_ORTHOGRAPHIC, 0], [SHADOW_PROJECTION_PERSPECTIVE, 0], [SHADOW_PROJECTION_CUBE, 0]]);
        expect(lightShadowSlots(device, 3)).toEqual([FIRST_RECORD, THIRD_RECORD, SECOND_RECORD]);
    });

    test("over budget, the extra lights keep no map and their slots say so; a rect light casts through a cube but not behind its emitter", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addLamp(world, LAMP_Z);
        addLamp(world, LAMP_Z + 1);
        addLamp(world, LAMP_Z + 2);
        addShadowSettings(world, {maxPointShadows: BUDGET_OF_TWO});
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        expect(lightShadowSlots(device, 3)).toEqual([FIRST_RECORD, SECOND_RECORD, NO_SHADOW_MAP_SLOT]);
        expect(lastShadowSubmission(device).length).toBe(BUDGET_OF_TWO * CUBE_FACES);

        const facingAway = Quaternions.eulerToQuat(Vec.alloc3(NO_TURN_RAD, Math.PI, NO_TURN_RAD));
        const awayRig = shadowRig();
        awayRig.world.entityManager.createEntity("rect", [Object.assign(new RectAreaLight(LIGHT_RANGE), {castsShadows: CASTS}), new LocalPosition(0, 0, LAMP_Z), new LocalToWorld(),
            new LocalRotation(Vec.x(facingAway), Vec.y(facingAway), Vec.z(facingAway), Vec.w(facingAway))]);
        addShadowSettings(awayRig.world);
        addQuadAt(awayRig.world, quad(), 0, IN_FRONT_Z);
        await step(awayRig, SETTLE_STEPS);
        expect(passesLabelled(awayRig.device, SHADOW_PASS_LABEL)).toEqual([]);
        expect(lightShadowSlots(awayRig.device, 1)).toEqual([NO_SHADOW_MAP_SLOT]);

        const facingRig = shadowRig();
        addLight(facingRig.world, new RectAreaLight(LIGHT_RANGE), LAMP_Z);
        addShadowSettings(facingRig.world);
        addQuadAt(facingRig.world, quad(), 0, IN_FRONT_Z);
        await step(facingRig, SETTLE_STEPS);
        expect(lastShadowSubmission(facingRig.device).map(instancesDrawn)).toEqual([0, 0, 0, 0, 1, 0]);
        expect([awayRig.errors, facingRig.errors]).toEqual([[], []]);
    });

    test("a spot map's frustum covers the outer cone plus a filter margin, and stays short of a half turn", () => {
        const margin = SPOT_MAP_SIZE / (SPOT_MAP_SIZE - 2 * SPOT_SHADOW_EDGE_MARGIN_TEXELS);
        expect(spotShadowTanHalfAngleOf(Math.cos(SPOT_OUTER_CONE), SPOT_MAP_SIZE)).toBeCloseTo(Math.tan(SPOT_OUTER_CONE) * margin, DIGITS);
        expect(spotShadowTanHalfAngleOf(Math.cos(Math.PI / 2), SPOT_MAP_SIZE)).toBeCloseTo(Math.tan(SPOT_SHADOW_MAX_HALF_ANGLE) * margin, DIGITS);
        expect(spotShadowTanHalfAngleOf(1, SPOT_MAP_SIZE)).toBeCloseTo(Math.tan(SPOT_SHADOW_MIN_HALF_ANGLE) * margin, DIGITS);
    });

    test("the caster pipeline is depth-only, culls no faces, carries the slope bias, and is cached and evicted like the others", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addSun(world);
        const {shadows} = addShadowSettings(world);
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        const [pipeline] = shadowPipelines(device);
        expect(shadowPipelines(device).length).toBe(1);
        expect(pipeline.fragment).toBe(undefined);
        expect(pipeline.primitive?.cullMode).toBe(SHADOW_CASTER_CULL_MODE);
        expect(SHADOW_CASTER_CULL_MODE).toBe("none");
        expect([pipeline.depthStencil?.format, pipeline.depthStencil?.depthCompare, pipeline.depthStencil?.depthBiasSlopeScale]).toEqual([SHADOW_MAP_FORMAT, "less", SLOPE_BIAS]);
        shadows.slopeBias = OTHER_SLOPE_BIAS;
        await step(rig, SETTLE_STEPS);
        expect(shadowPipelines(device).map(created => created.depthStencil?.depthBiasSlopeScale)).toEqual([SLOPE_BIAS, OTHER_SLOPE_BIAS]);
        shadows.slopeBias = SLOPE_BIAS;
        await step(rig, EVICT_AFTER_FRAMES + SETTLE_STEPS);
        shadows.slopeBias = OTHER_SLOPE_BIAS;
        await step(rig);
        expect(shadowPipelines(device).map(created => created.depthStencil?.depthBiasSlopeScale)).toEqual([SLOPE_BIAS, OTHER_SLOPE_BIAS, OTHER_SLOPE_BIAS]);
        expect(rig.errors).toEqual([]);
    });

    test("a map array is kept while its size and budget hold, replaced on a size change, grown for more lights, shrunk with the budget, and destroyed once unused past eviction", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addSun(world);
        const {entity, shadows} = addShadowSettings(world);
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(texturesLabelled(device, DIRECTIONAL_SHADOW_MAPS_LABEL).length).toBe(1);
        shadows.mapSize = OTHER_MAP_SIZE;
        await step(rig, SETTLE_STEPS);
        const [first, second] = texturesLabelled(device, DIRECTIONAL_SHADOW_MAPS_LABEL);
        expect(texturesLabelled(device, DIRECTIONAL_SHADOW_MAPS_LABEL).length).toBe(2);
        expect([first.destroyed, second.destroyed]).toEqual([true, false]);
        expect(second.descriptor.size).toEqual({width: OTHER_MAP_SIZE, height: OTHER_MAP_SIZE, depthOrArrayLayers: 1});
        expect(boundView(device, DIRECTIONAL_SHADOW_MAPS_BINDING).texture).toBe(second);

        addLamp(world, LAMP_Z);
        addLamp(world, LAMP_Z + 1);
        await step(rig, SETTLE_STEPS);
        const cubes = texturesLabelled(device, POINT_SHADOW_MAPS_LABEL);
        expect(cubes.map(texture => [texture.destroyed, texture.descriptor.size])).toEqual([[false, {width: POINT_MAP_SIZE, height: POINT_MAP_SIZE, depthOrArrayLayers: 2 * CUBE_FACES}]]);
        shadows.maxPointShadows = ONE_CUBE;
        await step(rig, SETTLE_STEPS);
        expect(texturesLabelled(device, POINT_SHADOW_MAPS_LABEL).map(texture => [texture.destroyed, (texture.descriptor.size as GPUExtent3DDict).depthOrArrayLayers]))
            .toEqual([[true, 2 * CUBE_FACES], [false, CUBE_FACES]]);
        const settled = [device.textures.length, device.buffers.length, device.bindGroups.length];
        await step(rig, MORE_STEPS);
        expect([device.textures.length, device.buffers.length, device.bindGroups.length]).toEqual(settled);

        world.entityManager.removeComponent(entity, GpuShadowSettings);
        await step(rig);
        expect([DIRECTIONAL_SHADOW_MAPS_BINDING, SPOT_SHADOW_MAPS_BINDING, POINT_SHADOW_MAPS_BINDING].map(binding => boundView(device, binding).texture.descriptor.label))
            .toEqual([NO_SHADOW_MAP_LABEL, NO_SHADOW_MAP_LABEL, NO_SHADOW_MAP_LABEL]);
        expect(lastShadowWords(device)[SHADOWS_MAP_COUNT_OFFSET]).toBe(0);
        expect(lightShadowSlots(device, 3)).toEqual([NO_SHADOW_MAP_SLOT, NO_SHADOW_MAP_SLOT, NO_SHADOW_MAP_SLOT]);
        expect(second.destroyed).toBe(false);
        await step(rig, EVICT_AFTER_FRAMES + 1);
        expect(second.destroyed).toBe(true);
        expect(device.liveTextures().filter(texture => SHADOW_TEXTURE_LABELS.includes(texture.descriptor.label ?? "")).map(texture => texture.descriptor.label)).toEqual([NO_SHADOW_MAP_LABEL]);
        expect(boundView(device, DIRECTIONAL_SHADOW_MAPS_BINDING).texture.descriptor.label).toBe(NO_SHADOW_MAP_LABEL);
        expect(rig.errors).toEqual([]);
    });

    test("casters beside the light box are left out of the directional map", async () => {
        const rig = shadowRig();
        addSun(rig.world, DOWNWARD_TILT_RAD);
        addShadowSettings(rig.world);
        const mesh = quad();
        addQuadAt(rig.world, mesh, 0, IN_FRONT_Z);
        addQuadAt(rig.world, mesh, FAR_TO_THE_SIDE_X, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(instancesDrawn(lastPass(rig.device, SHADOW_PASS_LABEL)!)).toBe(1);
    });

    test("casters pick a LOD level from their footprint in the shadow map, or the base level with LOD off", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addSun(world);
        addShadowSettings(world, {mapSize: MIN_SHADOW_MAP_SIZE});
        const mesh = meshWithLods();
        const meshSettings = Object.assign(new MeshRenderSettings(), {lod: true});
        world.entityManager.createEntity("mesh settings", [meshSettings]);
        addQuadAt(world, mesh, 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        const coarsest = mesh.lods[mesh.lods.length - 1];
        expect(lastPass(device, SHADOW_PASS_LABEL)!.callsOf("drawIndexed").map(call => call.args[0])).toEqual([coarsest.triangleCount * TRIANGLE_CORNERS]);
        meshSettings.lod = false;
        await step(rig, SETTLE_STEPS);
        expect(lastPass(device, SHADOW_PASS_LABEL)!.callsOf("drawIndexed").map(call => call.args[0])).toEqual([mesh.triangleCount * TRIANGLE_CORNERS]);
    });

    test("destroying the world destroys every map array, the placeholder and every shadow buffer", async () => {
        const rig = shadowRig(false);
        addSun(rig.world);
        addSpot(rig.world);
        addLamp(rig.world);
        addShadowSettings(rig.world);
        addQuadAt(rig.world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect([DIRECTIONAL_SHADOW_MAPS_LABEL, SPOT_SHADOW_MAPS_LABEL, POINT_SHADOW_MAPS_LABEL].map(label => texturesLabelled(rig.device, label).length)).toEqual([1, 1, 1]);
        expect(liveBufferLabels(rig.device).filter(label => [SHADOWS_LABEL, SHADOW_CASTER_UNIFORMS_LABEL, SHADOW_INSTANCES_LABEL].includes(label)))
            .toEqual([SHADOW_CASTER_UNIFORMS_LABEL, SHADOW_INSTANCES_LABEL, SHADOWS_LABEL]);
        rig.world.stop();
        expect(rig.device.liveBuffers().map(buffer => buffer.descriptor.label)).toEqual([]);
        expect(rig.device.liveTextures().map(texture => texture.descriptor.label)).toEqual([]);
    });
});
