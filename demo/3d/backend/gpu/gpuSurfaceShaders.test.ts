import {describe, expect, test} from "../../../../src/engine/testing/harness";
import {MemoryPlatform} from "../../../../src/engine/testing/memoryPlatform";
import {EntityCommandBufferSystem, World} from "../../../../src/engine/core";
import {Vec} from "../../../../src/engine/math/types/vec";
import {Camera} from "../../../../src/engine/rendering/camera";
import {ShaderSource} from "../../../../src/engine/rendering";
import {GpuRenderBackend} from "../../../../src/engine/rendering/renderBackend";
import {Mesh, MeshBuilder} from "../../../../src/engine/rendering/3d/mesh";
import {Material} from "../../../../src/engine/rendering/3d/material";
import {RenderMesh} from "../../../../src/engine/rendering/3d/renderMesh";
import {FieldOfView} from "../../../../src/engine/rendering/3d/fieldOfView";
import {LocalPosition, LocalToWorld} from "../../../../src/engine/translation";
import {MemoryPixelPresenter} from "../../../../src/backends/pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../../../../src/backends/pixels/pixelPresenterResource";
import {GpuDeviceResource} from "../../../../src/backends/gpu/gpuDeviceResource";
import {GpuFrame} from "../../../../src/backends/gpu/gpuFrame";
import {GpuCanvasPixelPresenter} from "../../../../src/backends/gpu/gpuCanvasPixelPresenter";
import {GpuMeshPassSystem} from "../../../../src/backends/gpu/gpuMeshPassSystem";
import {SURFACE_FUNCTION_SIGNATURE} from "../../../../src/backends/gpu/shaders/basicLitShader";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "../../../../src/backends/gpu/testing/fakeGpuDevice";
import type {FakeRenderPass} from "../../../../src/backends/gpu/testing/fakeGpuDevice";
import {Demo3dTuning, SurfaceShaderChoice} from "../../tuning";
import {DemoSurfaceShaderSystem} from "./gpuSurfaceShaders";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SIZE = {widthPx: 64, heightPx: 48};
const QUAD_DISTANCE = 4;
const SETTLE_STEPS = 6;
const TOON = "toon";
const TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * 0.5, 1.0);
}`;

function ignore(): void {
}

function quad(): Mesh {
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(-1, -1, 0), Vec.alloc3(1, -1, 0), Vec.alloc3(1, 1, 0), Vec.alloc3(-1, 1, 0));
    builder.uvs.push(Vec.alloc2(0, 0), Vec.alloc2(1, 0), Vec.alloc2(1, 1), Vec.alloc2(0, 1));
    builder.triangles.push(Vec.alloc3(0, 2, 1), Vec.alloc3(0, 3, 2));
    builder.materials.push(new Material("flat", 0x336699));
    builder.vertexMaterial.push(0, 0, 0, 0);
    builder.generateNormals();
    return new Mesh(builder);
}

function toonTuning(): Demo3dTuning {
    const choice = Object.assign(new SurfaceShaderChoice(), {name: TOON, shader: new ShaderSource(undefined, TOON_SOURCE)});
    return Object.assign(new Demo3dTuning(), {surfaceShaders: [choice]});
}

function shadedWorld(): {world: World, device: FakeGpuDevice} {
    const world = new World({platform: new MemoryPlatform()});
    const device = new FakeGpuDevice();
    const canvas = new FakeCanvas();
    const gpu = new GpuDeviceResource(device, new GpuFrame(device, new FakeCanvasContext(canvas, FORMAT), canvas, FORMAT));
    world.resources.insert(gpu);
    world.resources.insert(new PixelPresenterResource(new GpuCanvasPixelPresenter(new MemoryPixelPresenter(SIZE), gpu, ignore)));
    world.resources.insert(new GpuRenderBackend());
    world.resources.insert(toonTuning());
    world.entityManager.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    world.getOrCreateSystem(DemoSurfaceShaderSystem);
    world.getOrCreateSystem(GpuMeshPassSystem);
    return {world, device};
}

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

async function step(world: World, device: FakeGpuDevice, times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
        world.step();
        device.queue.completeSubmittedWork();
        await nextTask();
    }
}

function scenePasses(device: FakeGpuDevice): FakeRenderPass[] {
    return device.submittedPasses.filter(pass => pass.descriptor.label === "scene");
}

function shaderNamesDrawn(pass: FakeRenderPass): string[] {
    return pass.callsOf("setPipeline").map(call => ((call.args[0] as GPURenderPipelineDescriptor).label ?? "").split("|")[0]);
}

function instancesDrawn(pass: FakeRenderPass): number {
    return pass.callsOf("drawIndexed").reduce((sum, call) => sum + (call.args[1] as number), 0);
}

describe("DemoSurfaceShaderSystem", () => {
    test("a model spawned through the command buffer is drawn with the selected surface shader from its first drawn frame", async () => {
        const {world, device} = shadedWorld();
        const mesh = quad();
        world.entityManager.createEntity("placed", [new RenderMesh(mesh), new LocalToWorld(), new LocalPosition(0, 0, QUAD_DISTANCE)]);
        await step(world, device, SETTLE_STEPS);
        expect(shaderNamesDrawn(scenePasses(device).at(-1)!)).toEqual([TOON]);

        world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer()
            .createEntity("spawned", [new RenderMesh(mesh), new LocalToWorld(), new LocalPosition(1, 0, QUAD_DISTANCE)]);
        const drawnBefore = scenePasses(device).length;
        await step(world, device, SETTLE_STEPS);
        const firstWithSpawned = scenePasses(device).slice(drawnBefore).find(pass => instancesDrawn(pass) === 2)!;
        expect(shaderNamesDrawn(firstWithSpawned)).toEqual([TOON]);
    });
});
