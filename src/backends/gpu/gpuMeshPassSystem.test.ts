import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {DebugWorld, World} from "../../engine/core";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {Vec} from "../../engine/math/types/vec";
import {Camera} from "../../engine/rendering/camera";
import {Mesh, MeshBuilder} from "../../engine/rendering/3d/mesh";
import {Material} from "../../engine/rendering/3d/material";
import {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {MeshRenderSettings} from "../../engine/rendering/3d/meshRenderSettings";
import {MeshRenderStats} from "../../engine/rendering/3d/meshRenderStats";
import {LocalPosition, LocalToWorld} from "../../engine/translation";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {MeshPixelPassSettings} from "../pixels/3d/meshPixelPassSettings";
import {MeshPixelPassSystem} from "../pixels/3d/meshPixelPassSystem";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {PixelRenderSettings} from "../pixels/pixelRenderSettings";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {GpuFrame} from "./gpuFrame";
import {GpuCanvasPixelPresenter} from "./gpuCanvasPixelPresenter";
import {GPU_BACKEND_EXPERIMENTAL_NOTICE, GpuMeshPassSystem} from "./gpuMeshPassSystem";
import {GpuMeshPassSettings, LINEAR_TEXTURE_FILTERING, MULTISAMPLE_COUNT, NEAREST_TEXTURE_FILTERING, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";
import type {GpuTextureFiltering} from "./gpuMeshPassSettings";
import {clearColorOf} from "./gpuFrame";
import {INSTANCE_FLOATS, INSTANCE_PARAMS_OFFSET} from "./gpuInstanceBatcher";
import {FRAME_TIME_OFFSET, FRAME_UNIFORM_FLOATS} from "./gpuCamera";
import {GpuShaderLibrary, unknownSurfaceShaderMessage} from "./gpuShaderLibrary";
import {GpuSurfaceShader, LIT_SURFACE_SHADER, SURFACE_SHADER_PARAMS} from "./gpuSurfaceShader";
import {MATERIAL_BIND_GROUP, MATERIAL_SAMPLER_BINDING, MATERIAL_TEXTURED_OFFSET, MATERIAL_UNTEXTURED, SURFACE_FUNCTION_SIGNATURE} from "./shaders/basicLitShader";
import {compilationError, FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "./testing/fakeGpuDevice";
import type {FakeRenderPass, FakeGpuTextureView} from "./testing/fakeGpuDevice";
import {ConsoleRecorder} from "./testing/consoleRecorder";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SIZE = {widthPx: 64, heightPx: 48};
const QUAD_DISTANCE = 4;
const QUAD_TRIANGLES = 2;
const QUADS = 3;
const BACKGROUND = 0x203040;
const SETTLE_STEPS = 3;
const LOD_GRID_CELLS = [32, 16, 8, 2];
const LOD_TRIANGLES_PER_PIXEL = 1;
const ONE_LEVEL_COARSER = 1;
const TRIANGLE_CORNERS = 3;
const GRID_HALF_SIZE = 1;
const OFF_SCREEN_X = 30;

interface Placement {
    readonly x: number;
    readonly z: number;
}

const ONE_PER_LEVEL_AND_TWO_CULLED: readonly Placement[] = [
    {x: 0, z: 1.5}, {x: 0, z: 2.5}, {x: 0, z: 4}, {x: 0, z: 12},
    {x: OFF_SCREEN_X, z: 4}, {x: 0, z: -4},
];

interface LodSettings {
    readonly lod: boolean;
    readonly lodBias: number;
}

const LOD_ON: LodSettings = {lod: true, lodBias: 0};

const TOON = "toon";
const BROKEN = "broken";
const UNREGISTERED = "unregistered";
const TOON_PARAMS = [1, 2, 3, 4, 5, 6, 7, 8];
const TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * input.params[0], 1.0);
}`;
const BROKEN_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return oops;
}`;
const BROKEN_TOKEN = "oops";
const BROKEN_COLUMN = 12;
const MANY_FRAMES = 8;
const CLOCK_ADVANCE_MS = 20;
const MS_PER_SECOND = 1000;
const HALF = 2;
const ONE_SAMPLE_PER_AXIS = 1;

function ignore(): void {
}

const recorders: ConsoleRecorder[] = [];

function recordConsole(): ConsoleRecorder {
    const recorder = new ConsoleRecorder();
    recorders.push(recorder);
    return recorder;
}

function experimentalNotices(recorder: ConsoleRecorder): number {
    return recorder.warnings.filter(warning => warning === GPU_BACKEND_EXPERIMENTAL_NOTICE).length;
}

function lineOf(code: string, token: string): number {
    return code.split("\n").findIndex(line => line.includes(token)) + 1;
}

function failWhereBroken(device: FakeGpuDevice): void {
    device.compilationMessages = code => code.includes(BROKEN_TOKEN) ? [compilationError(`unresolved value '${BROKEN_TOKEN}'`, lineOf(code, BROKEN_TOKEN), BROKEN_COLUMN)] : [];
}

function pipelineLabels(pass: FakeRenderPass): string[] {
    return pass.callsOf("setPipeline").map(call => (call.args[0] as GPURenderPipelineDescriptor).label ?? "");
}

function drawsWithLitOnly(pass: FakeRenderPass): boolean {
    return pipelineLabels(pass).every(label => label.startsWith(`${LIT_SURFACE_SHADER}|`));
}

function addShadedQuads(world: World, mesh: Mesh, count: number, shader: () => GpuSurfaceShader): void {
    for (let i = 0; i < count; i++) {
        world.entityManager.createEntity("shaded quad", [new RenderMesh(mesh), new LocalToWorld(), new LocalPosition(i, 0, QUAD_DISTANCE), shader()]);
    }
}

function lastInstanceWrite(device: FakeGpuDevice): Float32Array {
    return device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === "instances").at(-1)!.data as Float32Array;
}

function frameUniformWrites(device: FakeGpuDevice): Float32Array[] {
    return device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === "frame uniforms").map(write => write.data as Float32Array);
}

afterEach(() => {
    for (const recorder of recorders.splice(0)) recorder.detach();
});

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

function place(world: World, mesh: Mesh, placements: readonly Placement[]): void {
    for (const {x, z} of placements) world.entityManager.createEntity("grid", [new RenderMesh(mesh), new LocalToWorld(), new LocalPosition(x, 0, z)]);
}

function softwareLodStats(mesh: Mesh, placements: readonly Placement[], {lod, lodBias}: LodSettings): MeshRenderStats {
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(new MemoryPixelPresenter(SIZE)));
    const root = world.getOrCreateSystem(RootSystemGroup);
    world.entityManager.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    const settings = Object.assign(new MeshPixelPassSettings(), {framebufferPixelsPerRasterPixel: 1, lodTrianglesPerPixel: LOD_TRIANGLES_PER_PIXEL});
    world.entityManager.createEntity("settings", [settings, Object.assign(new MeshRenderSettings(), {lod, lodBias})]);
    place(world, mesh, placements);
    world.getOrCreateSystem(MeshPixelPassSystem);
    for (let i = 0; i < SETTLE_STEPS; i++) root.update();
    return world.resources.get(MeshRenderStats);
}

async function gpuLodPass(mesh: Mesh, placements: readonly Placement[], {lod, lodBias}: LodSettings): Promise<{stats: MeshRenderStats, device: FakeGpuDevice}> {
    const rig = gpuWorld();
    const settings = Object.assign(new GpuMeshPassSettings(), {lodTrianglesPerPixel: LOD_TRIANGLES_PER_PIXEL});
    rig.world.entityManager.createEntity("gpu settings", [settings, Object.assign(new MeshRenderSettings(), {lod, lodBias})]);
    place(rig.world, mesh, placements);
    rig.world.getOrCreateSystem(GpuMeshPassSystem);
    await step(rig, SETTLE_STEPS);
    expect(rig.errors).toEqual([]);
    return {stats: rig.world.resources.get(MeshRenderStats), device: rig.device};
}

function samplerFilterOfLastMaterialBinding(device: FakeGpuDevice): GPUFilterMode | undefined {
    const bindings = lastScenePass(device)!.callsOf("setBindGroup").filter(call => call.args[0] === MATERIAL_BIND_GROUP);
    const bindGroup = bindings.at(-1)!.args[1] as GPUBindGroupDescriptor;
    const sampler = [...bindGroup.entries].find(entry => entry.binding === MATERIAL_SAMPLER_BINDING)!.resource as GPUSamplerDescriptor;
    return sampler.magFilter;
}

interface GpuWorld {
    readonly world: World;
    readonly device: FakeGpuDevice;
    readonly errors: unknown[];
}

function gpuWorld(debug: boolean = true): GpuWorld {
    const world = debug ? new DebugWorld({platform: new MemoryPlatform()}) : new World({platform: new MemoryPlatform()});
    const errors: unknown[] = [];
    world.onStopped.add(event => errors.push(event.error));
    const device = new FakeGpuDevice();
    const canvas = new FakeCanvas();
    const gpu = new GpuDeviceResource(device, new GpuFrame(device, new FakeCanvasContext(canvas, FORMAT), canvas, FORMAT));
    world.resources.insert(gpu);
    world.resources.insert(new PixelPresenterResource(new GpuCanvasPixelPresenter(new MemoryPixelPresenter(SIZE), gpu, ignore)));
    world.entityManager.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    return {world, device, errors};
}

function addQuads(world: World, mesh: Mesh, count: number, culling: FaceCulling = FaceCulling.BackFaces): void {
    for (let i = 0; i < count; i++) {
        const renderMesh = new RenderMesh(mesh);
        renderMesh.faceCulling = culling;
        world.entityManager.createEntity("quad", [renderMesh, new LocalToWorld(), new LocalPosition(i, 0, QUAD_DISTANCE)]);
    }
}

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

async function step({world, device}: GpuWorld, times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
        world.step();
        device.queue.completeSubmittedWork();
        await nextTask();
    }
}

function lastScenePass(device: FakeGpuDevice): FakeRenderPass | undefined {
    return device.submittedPasses.filter(pass => pass.descriptor.label === "scene").at(-1);
}

describe("GpuMeshPassSystem", () => {
    test("warns once per system instance that the backend is experimental, however many frames run", async () => {
        const recorder = recordConsole();
        const first = gpuWorld();
        first.world.getOrCreateSystem(GpuMeshPassSystem);
        await step(first, SETTLE_STEPS);
        expect(experimentalNotices(recorder)).toBe(1);
        const second = gpuWorld();
        second.world.getOrCreateSystem(GpuMeshPassSystem);
        await step(second, SETTLE_STEPS);
        expect(experimentalNotices(recorder)).toBe(2);
        expect([...first.errors, ...second.errors]).toEqual([]);
    });

    test("lifts the CPU render rate limit while enabled, though the pixel overlay still renders on the CPU", () => {
        recordConsole();
        const {world} = gpuWorld();
        const pass = world.getOrCreateSystem(GpuMeshPassSystem);
        expect([world.renderers.count("cpu"), world.renderers.count("gpu")]).toEqual([1, 1]);
        expect(world.renderers.framesRenderedOnCpu).toBe(false);
        pass.enabled = false;
        expect(world.renderers.framesRenderedOnCpu).toBe(true);
        pass.enabled = true;
        world.stop();
        expect([world.renderers.count("cpu"), world.renderers.count("gpu")]).toEqual([0, 0]);
    });

    test("draws every instance of a mesh in one instanced call and counts its triangles", async () => {
        const rig = gpuWorld();
        const {world, device, errors} = rig;
        world.getOrCreateSystem(GpuMeshPassSystem);
        addQuads(world, quad(), QUADS);
        await step(rig, SETTLE_STEPS);
        expect(errors).toEqual([]);
        const stats = world.resources.get(MeshRenderStats);
        expect(stats.trianglesDrawn).toBe(QUADS * QUAD_TRIANGLES);
        expect(stats.lodLevelCounts[0]).toBe(QUADS);
        expect(stats.rasterWorkers).toBe(0);
        const scene = lastScenePass(device)!;
        expect(scene.callsOf("drawIndexed").map(call => call.args)).toEqual([[QUAD_TRIANGLES * 3, QUADS, 0, 0, 0]]);
        const instanceWrites = device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === "instances");
        expect(instanceWrites.at(-1)!.data.byteLength).toBe(QUADS * INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT);
        expect(device.buffers.filter(buffer => buffer.descriptor.label?.endsWith("vertices")).length).toBe(1);
    });

    test("meshes sharing a mesh but not its face culling are separate batches with contiguous instances", async () => {
        const rig = gpuWorld();
        const {world, device} = rig;
        world.getOrCreateSystem(GpuMeshPassSystem);
        const mesh = quad();
        addQuads(world, mesh, 2);
        addQuads(world, mesh, 1, FaceCulling.None);
        await step(rig, SETTLE_STEPS);
        const draws = lastScenePass(device)!.callsOf("drawIndexed").map(call => [call.args[1], call.args[4]]);
        expect(draws).toEqual([[2, 0], [1, 2]]);
        const cullModes = device.pipelines.filter(pipeline => pipeline.label?.startsWith(`${LIT_SURFACE_SHADER}|`)).map(pipeline => pipeline.primitive?.cullMode);
        expect(cullModes).toEqual(["back", "none"]);
    });

    test("defaults without settings: 4x multisampling over the pixel background; 1x1 mesh supersampling switches to one sample, and textures off", async () => {
        const rig = gpuWorld();
        const {world, device} = rig;
        world.entityManager.createEntity("render settings", [Object.assign(new PixelRenderSettings(), {backgroundColor: BACKGROUND})]);
        world.getOrCreateSystem(GpuMeshPassSystem);
        const material = new Material("textured");
        addQuads(world, quad(material), 1);
        await step(rig, SETTLE_STEPS);
        const colorOf = (pass: FakeRenderPass) => [...pass.descriptor.colorAttachments][0]!;
        const sampleCountOf = (pass: FakeRenderPass) => ((colorOf(pass).view as unknown as FakeGpuTextureView).texture.descriptor.sampleCount ?? SINGLE_SAMPLE_COUNT);
        expect(colorOf(lastScenePass(device)!).clearValue).toEqual(clearColorOf(BACKGROUND));
        expect(sampleCountOf(lastScenePass(device)!)).toBe(MULTISAMPLE_COUNT);

        const meshSettings = Object.assign(new MeshRenderSettings(), {supersampleX: ONE_SAMPLE_PER_AXIS, supersampleY: ONE_SAMPLE_PER_AXIS, textures: false});
        world.entityManager.createEntity("mesh settings", [meshSettings]);
        await step(rig, SETTLE_STEPS);
        expect(sampleCountOf(lastScenePass(device)!)).toBe(SINGLE_SAMPLE_COUNT);
        const materialWrites = device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === "material textured");
        expect((materialWrites.at(-1)!.data as Float32Array)[MATERIAL_TEXTURED_OFFSET]).toBe(MATERIAL_UNTEXTURED);
    });

    test("without meshes there is no scene pass, but the frame is still presented", async () => {
        const rig = gpuWorld();
        const {world, device} = rig;
        world.getOrCreateSystem(GpuMeshPassSystem);
        await step(rig, SETTLE_STEPS);
        expect([lastScenePass(device), world.resources.get(MeshRenderStats).trianglesDrawn]).toEqual([undefined, 0]);
        expect(device.queue.submissions.length).toBeGreaterThan(0);
    });

    test("destroying the world destroys every buffer the pass made", async () => {
        const rig = gpuWorld(false);
        const {world, device} = rig;
        world.getOrCreateSystem(GpuMeshPassSystem);
        addQuads(world, quad(), QUADS);
        await step(rig, SETTLE_STEPS);
        world.stop();
        expect(device.liveBuffers().length).toBe(0);
        expect(device.liveTextures().length).toBe(0);
    });

    test("selects the same LOD levels and draws the same triangles as the software pass, culling what is off screen or behind", async () => {
        const mesh = meshWithLods();
        const software = softwareLodStats(mesh, ONE_PER_LEVEL_AND_TWO_CULLED, LOD_ON);
        const {stats, device} = await gpuLodPass(mesh, ONE_PER_LEVEL_AND_TWO_CULLED, LOD_ON);
        expect(Array.from(software.lodLevelCounts.subarray(0, LOD_GRID_CELLS.length))).toEqual([1, 1, 1, 1]);
        expect(Array.from(stats.lodLevelCounts)).toEqual(Array.from(software.lodLevelCounts));
        expect(stats.trianglesDrawn).toBe(software.trianglesDrawn);
        const drawnIndexCounts = lastScenePass(device)!.callsOf("drawIndexed").map(call => call.args[0]);
        expect(drawnIndexCounts).toEqual(mesh.lods.map(level => level.triangleCount * TRIANGLE_CORNERS));
    });

    test("the bias and the lod toggle select levels as the software pass does", async () => {
        const mesh = meshWithLods();
        for (const settings of [{lod: true, lodBias: ONE_LEVEL_COARSER}, {lod: false, lodBias: 0}]) {
            const software = softwareLodStats(mesh, ONE_PER_LEVEL_AND_TWO_CULLED, settings);
            const {stats} = await gpuLodPass(mesh, ONE_PER_LEVEL_AND_TWO_CULLED, settings);
            expect(Array.from(stats.lodLevelCounts)).toEqual(Array.from(software.lodLevelCounts));
            expect(stats.trianglesDrawn).toBe(software.trianglesDrawn);
        }
        const {stats: lodOff} = await gpuLodPass(mesh, ONE_PER_LEVEL_AND_TWO_CULLED, {lod: false, lodBias: 0});
        expect(Array.from(lodOff.lodLevelCounts.subarray(0, LOD_GRID_CELLS.length))).toEqual([4, 0, 0, 0]);
    });

    test("instances of one mesh at different levels are separate batches with their own instance ranges", async () => {
        const mesh = meshWithLods();
        const nearAndFar: Placement[] = [{x: 0, z: 1.5}, {x: 0.5, z: 12}, {x: -0.5, z: 1.6}, {x: 0, z: 13}];
        const {stats, device} = await gpuLodPass(mesh, nearAndFar, LOD_ON);
        expect(Array.from(stats.lodLevelCounts.subarray(0, LOD_GRID_CELLS.length))).toEqual([2, 0, 0, 2]);
        const draws = lastScenePass(device)!.callsOf("drawIndexed").map(call => [call.args[0], call.args[1], call.args[4]]);
        expect(draws).toEqual([[mesh.lods[0].triangleCount * TRIANGLE_CORNERS, 2, 0], [mesh.lods[3].triangleCount * TRIANGLE_CORNERS, 2, 2]]);
    });

    test("LOD and filtering defaults match the pixels mesh pass: the same triangle budget, nearest texels", () => {
        const gpu = new GpuMeshPassSettings(), pixels = new MeshPixelPassSettings();
        expect(gpu.lodTrianglesPerPixel).toBe(pixels.lodTrianglesPerPixel);
        expect(gpu.textureFiltering).toBe(NEAREST_TEXTURE_FILTERING);
    });

    test("texture filtering switches the material sampler on the next frame", async () => {
        const rig = gpuWorld();
        const {world, device} = rig;
        const settings = new GpuMeshPassSettings();
        world.entityManager.createEntity("gpu settings", [settings]);
        world.getOrCreateSystem(GpuMeshPassSystem);
        addQuads(world, quad(), 1);
        const filterAfter = async (filtering: GpuTextureFiltering) => {
            settings.textureFiltering = filtering;
            await step(rig);
            return samplerFilterOfLastMaterialBinding(device);
        };
        await step(rig, SETTLE_STEPS);
        expect(samplerFilterOfLastMaterialBinding(device)).toBe("nearest");
        expect(await filterAfter(LINEAR_TEXTURE_FILTERING)).toBe("linear");
        expect(await filterAfter(NEAREST_TEXTURE_FILTERING)).toBe("nearest");
        expect(rig.errors).toEqual([]);
    });

    test("a GpuSurfaceShader draws its entities with the registered shader once its pipeline is ready, in a batch of their own with their params", async () => {
        const rig = gpuWorld();
        const {world, device, errors} = rig;
        world.resources.getOrCreate(GpuShaderLibrary).register(TOON, TOON_SOURCE);
        world.getOrCreateSystem(GpuMeshPassSystem);
        const mesh = quad();
        addQuads(world, mesh, 2);
        addShadedQuads(world, mesh, 1, () => new GpuSurfaceShader(TOON, TOON_PARAMS));
        await step(rig);
        expect(drawsWithLitOnly(lastScenePass(device)!)).toBe(true);
        await step(rig, SETTLE_STEPS);
        expect(errors).toEqual([]);
        const scene = lastScenePass(device)!;
        expect(pipelineLabels(scene).map(label => label.split("|")[0])).toEqual([LIT_SURFACE_SHADER, TOON]);
        expect(scene.callsOf("drawIndexed").map(call => [call.args[1], call.args[4]])).toEqual([[2, 0], [1, 2]]);
        const instances = lastInstanceWrite(device);
        const toonParams = INSTANCE_FLOATS * 2 + INSTANCE_PARAMS_OFFSET;
        expect(Array.from(instances.subarray(toonParams, toonParams + SURFACE_SHADER_PARAMS))).toEqual(TOON_PARAMS);
        expect(Array.from(instances.subarray(INSTANCE_PARAMS_OFFSET, INSTANCE_PARAMS_OFFSET + SURFACE_SHADER_PARAMS))).toEqual(new Array(SURFACE_SHADER_PARAMS).fill(0));
    });

    test("an unregistered shader name warns once and its entities draw with the built-in lit shader", async () => {
        const recorder = recordConsole();
        const rig = gpuWorld();
        const {world, device, errors} = rig;
        world.getOrCreateSystem(GpuMeshPassSystem);
        addShadedQuads(world, quad(), QUADS, () => new GpuSurfaceShader(UNREGISTERED));
        await step(rig, MANY_FRAMES);
        expect(errors).toEqual([]);
        expect(recorder.warnings.filter(warning => warning === unknownSurfaceShaderMessage(UNREGISTERED)).length).toBe(1);
        const scene = lastScenePass(device)!;
        expect(drawsWithLitOnly(scene)).toBe(true);
        expect(scene.callsOf("drawIndexed").map(call => call.args[1])).toEqual([QUADS]);
    });

    test("a shader that does not compile logs one error naming it and its entities keep drawing with the built-in lit shader", async () => {
        const recorder = recordConsole();
        const rig = gpuWorld();
        const {world, device, errors} = rig;
        failWhereBroken(device);
        world.resources.getOrCreate(GpuShaderLibrary).register(BROKEN, BROKEN_SOURCE);
        world.getOrCreateSystem(GpuMeshPassSystem);
        addShadedQuads(world, quad(), QUADS, () => new GpuSurfaceShader(BROKEN));
        await step(rig, MANY_FRAMES);
        expect(errors).toEqual([]);
        expect(recorder.errors.length).toBe(1);
        expect(recorder.errors[0].includes(`"${BROKEN}"`) && recorder.errors[0].includes(`unresolved value '${BROKEN_TOKEN}'`)).toBe(true);
        expect(device.asyncPipelines.length).toBe(0);
        const scene = lastScenePass(device)!;
        expect(drawsWithLitOnly(scene)).toBe(true);
        expect(scene.callsOf("drawIndexed").map(call => call.args[1])).toEqual([QUADS]);
    });

    test("the frame uniforms carry the seconds elapsed since the pass was created", async () => {
        const rig = gpuWorld();
        const {world, device} = rig;
        world.getOrCreateSystem(GpuMeshPassSystem);
        addQuads(world, quad(), 1);
        await step(rig);
        await new Promise<void>(done => setTimeout(done, CLOCK_ADVANCE_MS));
        await step(rig);
        const writes = frameUniformWrites(device);
        const first = writes[0][FRAME_TIME_OFFSET], last = writes.at(-1)![FRAME_TIME_OFFSET];
        expect(writes[0].length).toBe(FRAME_UNIFORM_FLOATS);
        expect(first >= 0).toBe(true);
        expect(last - first).toBeGreaterThan(CLOCK_ADVANCE_MS / HALF / MS_PER_SECOND);
    });
});
