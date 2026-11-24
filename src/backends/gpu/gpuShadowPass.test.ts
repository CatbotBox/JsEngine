import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {DebugWorld, World} from "../../engine/core";
import type {Entity} from "../../engine/core";
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
import {LocalPosition, LocalRotation, LocalToWorld} from "../../engine/translation";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {GpuFrame} from "./gpuFrame";
import {GpuCanvasPixelPresenter} from "./gpuCanvasPixelPresenter";
import {GpuMeshPassSystem} from "./gpuMeshPassSystem";
import {GpuMeshPassSettings} from "./gpuMeshPassSettings";
import {GpuShadowSettings, MIN_SHADOW_MAP_SIZE} from "./gpuShadowSettings";
import {NO_SHADOWED_LIGHT, SHADOW_ENABLED_OFFSET, SHADOW_LIGHT_INDEX_OFFSET, SHADOWS_OFF, SHADOWS_ON} from "./gpuShadowPacking";
import {SHADOW_INSTANCES_LABEL, SHADOW_MAP_LABEL, SHADOW_PASS_LABEL, SHADOW_UNIFORMS_LABEL} from "./gpuShadowPass";
import {SHADOW_CASTER_CULL_MODE, SHADOW_MAP_FORMAT} from "./gpuShadowPipelineCache";
import {SHADOW_CASTER_SHADER_NAME} from "./shaders/shadowCasterShader";
import {FRAME_BIND_GROUP, SHADOW_MAP_BINDING} from "./shaders/basicLitShader";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "./testing/fakeGpuDevice";
import type {FakeGpuTexture, FakeGpuTextureView, FakeRenderPass} from "./testing/fakeGpuDevice";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SIZE = {widthPx: 64, heightPx: 48};
const SETTLE_STEPS = 3;
const QUAD_TRIANGLES = 2;
const TRIANGLE_CORNERS = 3;
const IN_FRONT_Z = 4;
const BEHIND_CAMERA_Z = -4;
const FAR_TO_THE_SIDE_X = 500;
const MAP_SIZE = 256;
const OTHER_MAP_SIZE = 512;
const SLOPE_BIAS = 2;
const OTHER_SLOPE_BIAS = 3;
const EVICT_AFTER_FRAMES = 3;
const PLACEHOLDER_SIZE = 1;
const LOD_GRID_CELLS = [32, 16, 8, 2];
const GRID_HALF_SIZE = 1;
const FIRST_LIGHT = 0;
const NO_STRENGTH = 0;
const NO_MAP = 0;
const DOWNWARD_TILT_RAD = 0.6;
const NO_TURN_RAD = 0;

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

function addSun(world: World, pitchRad: number = NO_TURN_RAD): void {
    const rotation = Quaternions.eulerToQuat(Vec.alloc3(pitchRad, NO_TURN_RAD, NO_TURN_RAD));
    world.entityManager.createEntity("sun", [new DirectionalLight(), new LocalRotation(Vec.x(rotation), Vec.y(rotation), Vec.z(rotation), Vec.w(rotation)), new LocalToWorld()]);
}

interface AddedShadowSettings {
    readonly entity: Entity;
    readonly shadows: GpuShadowSettings;
}

function addShadowSettings(world: World, overrides: Partial<GpuShadowSettings> = {}): AddedShadowSettings {
    const shadows = Object.assign(new GpuShadowSettings(), {mapSize: MAP_SIZE, slopeBias: SLOPE_BIAS}, overrides);
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

function instancesDrawn(pass: FakeRenderPass): number {
    return pass.callsOf("drawIndexed").reduce((sum, call) => sum + (call.args[1] as number), 0);
}

function sampledShadowTexture(device: FakeGpuDevice): FakeGpuTexture {
    const frameBindings = lastPass(device, "scene")!.callsOf("setBindGroup").filter(call => call.args[0] === FRAME_BIND_GROUP);
    const bindGroup = frameBindings.at(-1)!.args[1] as GPUBindGroupDescriptor;
    const view = [...bindGroup.entries].find(entry => entry.binding === SHADOW_MAP_BINDING)!.resource as unknown as FakeGpuTextureView;
    return view.texture;
}

function lastShadowUniformWords(device: FakeGpuDevice): Uint32Array {
    const data = device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === SHADOW_UNIFORMS_LABEL).at(-1)!.data as Float32Array;
    return new Uint32Array(data.buffer, data.byteOffset, data.length);
}

function shadowMaps(device: FakeGpuDevice): FakeGpuTexture[] {
    return device.textures.filter(texture => texture.descriptor.label === SHADOW_MAP_LABEL);
}

function shadowPipelines(device: FakeGpuDevice): GPURenderPipelineDescriptor[] {
    return device.pipelines.filter(pipeline => pipeline.label?.startsWith(`${SHADOW_CASTER_SHADER_NAME}|`));
}

function submissionIndexOf(device: FakeGpuDevice, pass: FakeRenderPass): number {
    return device.queue.submissions.findIndex(buffers => buffers.some(buffer => buffer.passes.includes(pass)));
}

describe("GpuMeshPassSystem shadows", () => {
    test("without GpuShadowSettings there is no shadow pass or map, the uniforms say off and the frame binds a 1x1 placeholder", async () => {
        const rig = shadowRig();
        addSun(rig.world);
        addQuadAt(rig.world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        expect(passesLabelled(rig.device, SHADOW_PASS_LABEL)).toEqual([]);
        expect(shadowMaps(rig.device)).toEqual([]);
        const words = lastShadowUniformWords(rig.device);
        expect([words[SHADOW_ENABLED_OFFSET], words[SHADOW_LIGHT_INDEX_OFFSET]]).toEqual([SHADOWS_OFF, NO_SHADOWED_LIGHT]);
        const placeholder = sampledShadowTexture(rig.device).descriptor;
        expect([placeholder.size, placeholder.format]).toEqual([{width: PLACEHOLDER_SIZE, height: PLACEHOLDER_SIZE}, SHADOW_MAP_FORMAT]);
        expect(rig.world.resources.get(MeshRenderStats).trianglesDrawn).toBe(QUAD_TRIANGLES);
    });

    test("settings without a directional light, or with no strength or no map size, keep shadows off", async () => {
        const rig = shadowRig();
        rig.world.entityManager.createEntity("lamp", [new PointLight(), new LocalPosition(0, 2, 0), new LocalToWorld()]);
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
        expect(lastShadowUniformWords(rig.device)[SHADOW_ENABLED_OFFSET]).toBe(SHADOWS_OFF);
        expect(rig.errors).toEqual([]);
    });

    test("a depth-only shadow pass is submitted before the scene and draws casters the camera culls, such as one behind it", async () => {
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
        expect(((depth.view as unknown as FakeGpuTextureView).texture).descriptor.label).toBe(SHADOW_MAP_LABEL);
        expect(sampledShadowTexture(device).descriptor.size).toEqual({width: MAP_SIZE, height: MAP_SIZE});
        const words = lastShadowUniformWords(device);
        expect([words[SHADOW_ENABLED_OFFSET], words[SHADOW_LIGHT_INDEX_OFFSET]]).toEqual([SHADOWS_ON, FIRST_LIGHT]);
        const instanceWrites = device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === SHADOW_INSTANCES_LABEL);
        expect(instanceWrites.length).toBe(SETTLE_STEPS);
        expect(world.resources.get(MeshRenderStats).trianglesDrawn).toBe(QUAD_TRIANGLES);
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

    test("the shadow map is kept while its size holds, replaced when the size changes, and destroyed once shadows stay off past eviction", async () => {
        const rig = shadowRig();
        const {world, device} = rig;
        addSun(world);
        const {entity, shadows} = addShadowSettings(world);
        addQuadAt(world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(shadowMaps(device).length).toBe(1);
        shadows.mapSize = OTHER_MAP_SIZE;
        await step(rig, SETTLE_STEPS);
        const [first, second] = shadowMaps(device);
        expect(shadowMaps(device).length).toBe(2);
        expect([first.destroyed, second.destroyed]).toEqual([true, false]);
        expect(second.descriptor.size).toEqual({width: OTHER_MAP_SIZE, height: OTHER_MAP_SIZE});
        expect(sampledShadowTexture(device)).toBe(second);

        world.entityManager.removeComponent(entity, GpuShadowSettings);
        await step(rig);
        expect(sampledShadowTexture(device).descriptor.label).not.toBe(SHADOW_MAP_LABEL);
        expect(lastShadowUniformWords(device)[SHADOW_ENABLED_OFFSET]).toBe(SHADOWS_OFF);
        expect(second.destroyed).toBe(false);
        await step(rig, EVICT_AFTER_FRAMES + 1);
        expect(second.destroyed).toBe(true);
        expect(rig.errors).toEqual([]);
    });

    test("casters beside the light box are left out of the shadow map", async () => {
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

    test("destroying the world destroys the shadow map, the placeholder and every shadow buffer", async () => {
        const rig = shadowRig(false);
        addSun(rig.world);
        addShadowSettings(rig.world);
        addQuadAt(rig.world, quad(), 0, IN_FRONT_Z);
        await step(rig, SETTLE_STEPS);
        expect(shadowMaps(rig.device).length).toBe(1);
        rig.world.stop();
        expect(rig.device.liveBuffers().map(buffer => buffer.descriptor.label)).toEqual([]);
        expect(rig.device.liveTextures().map(texture => texture.descriptor.label)).toEqual([]);
    });
});
