import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {DebugWorld, World} from "../../engine/core";
import type {Entity} from "../../engine/core";
import {Vec} from "../../engine/math/types/vec";
import {Camera} from "../../engine/rendering/camera";
import {Mesh, MeshBuilder} from "../../engine/rendering/3d/mesh";
import {Material} from "../../engine/rendering/3d/material";
import {RenderMesh} from "../../engine/rendering/3d/renderMesh";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {FieldOfView} from "../../engine/rendering/3d/fieldOfView";
import {LocalPosition, LocalToWorld} from "../../engine/translation";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {PixelRenderSettings} from "../pixels/pixelRenderSettings";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {clearColorOf, DEPTH_FORMAT, GpuFrame} from "./gpuFrame";
import {GpuCanvasPixelPresenter} from "./gpuCanvasPixelPresenter";
import {GpuMeshPassSystem} from "./gpuMeshPassSystem";
import {GpuMeshPassSettings, MULTISAMPLE_COUNT} from "./gpuMeshPassSettings";
import {OVERLAY_TEXTURE_FORMAT} from "./gpuOverlayPass";
import {SHADOW_MAP_FORMAT} from "./gpuShadowPipelineCache";
import {GpuShaderLibrary} from "./gpuShaderLibrary";
import {MATERIAL_TEXTURE_FORMAT} from "./gpuTextureCache";
import {GpuSurfaceShader, LIT_SURFACE_SHADER} from "./gpuSurfaceShader";
import {linearClearColorOf} from "./gpuColorSpace";
import {HDR_SCENE_FORMAT, HDR_SCENE_OUTPUT, OVERRIDE_ENABLED} from "./gpuSceneOutput";
import {AGX_TONE_MAPPING, GpuPostProcessSettings, REINHARD_TONE_MAPPING} from "./gpuPostProcessSettings";
import type {GpuToneMapping} from "./gpuPostProcessSettings";
import {BLOOM_LEVEL_LABEL, bloomLevelCountFor, bloomLevelPx, HDR_SCENE_LABEL} from "./gpuHdrTargets";
import {BLOOM_DOWNSAMPLE_PASS_LABEL, BLOOM_UPSAMPLE_PASS_LABEL, COMPOSITE_PASS_LABEL, NO_BLOOM_LABEL, POST_PROCESS_UNIFORMS_LABEL} from "./gpuPostProcessPass";
import {
    BLOOM_DOWNSAMPLE_PIPELINE_LABEL,
    BLOOM_PREFILTER_PIPELINE_LABEL,
    BLOOM_UPSAMPLE_PIPELINE_LABEL,
    canvasEncodesSrgb,
    COMPOSITE_PIPELINE_LABEL,
    GpuPostProcessPipelineCache,
} from "./gpuPostProcessPipelineCache";
import {HDR_SCENE_OUTPUT_OVERRIDE, SURFACE_FUNCTION_SIGNATURE} from "./shaders/basicLitShader";
import {
    ACES_TONE_MAPPING_ID,
    AGX_TONE_MAPPING_ID,
    BLOOM_PREFILTER_OVERRIDE,
    ENCODE_SRGB_OUTPUT_OVERRIDE,
    POST_BLOOM_INTENSITY_OFFSET,
    POST_BLOOM_KNEE_OFFSET,
    POST_BLOOM_THRESHOLD_OFFSET,
    POST_EXPOSURE_OFFSET,
    POST_PROCESS_SHADER_NAME,
    REINHARD_TONE_MAPPING_ID,
    TONE_MAPPING_OVERRIDE,
} from "./shaders/postProcessShader";
import {POST_BLOOM_BINDING, POST_PROCESS_BIND_GROUP, POST_SOURCE_BINDING} from "./shaders/postProcessLayout";
import {OVERLAY} from "./shaders/overlayShader";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "./testing/fakeGpuDevice";
import type {FakeGpuTexture, FakeGpuTextureView, FakeRenderPass} from "./testing/fakeGpuDevice";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SRGB_FORMAT: GPUTextureFormat = "bgra8unorm-srgb";
const SIZE = {widthPx: 64, heightPx: 48};
const RESIZED = {widthPx: 96, heightPx: 40};
const QUAD_DISTANCE = 4;
const QUADS = 2;
const SETTLE_STEPS = 3;
const MORE_STEPS = 4;
const BACKGROUND = 0x203040;
const EVICT_AFTER_FRAMES = 3;
const FRAME = 1;
const OVERRIDE_DISABLED = 0;
const EXPOSURE = 1.5;
const BLOOM_INTENSITY = 0.2;
const BLOOM_THRESHOLD = 0.8;
const BLOOM_KNEE = 0.25;
const NEGATIVE = -2;
const UNKNOWN_TONE_MAPPING = "filmic" as GpuToneMapping;
const ONE_TEXEL = {width: 1, height: 1};
const BLOOM_VARIANTS = 3;
const COMPOSITE_VARIANTS = 2;
const PIPELINES_IN_USE = 1;
const MADE_AGAIN = 2;
const TOON = "toon";
const TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * 2.0, 1.0);
}`;
const DISPLAY_LIT_LABEL = `${LIT_SURFACE_SHADER}|${FaceCulling.BackFaces}|${FORMAT}|${MULTISAMPLE_COUNT}`;
const HDR_LIT_LABEL = `${LIT_SURFACE_SHADER}|${FaceCulling.BackFaces}|${HDR_SCENE_FORMAT}|${MULTISAMPLE_COUNT}|${HDR_SCENE_OUTPUT}`;

interface PostRig {
    readonly world: World;
    readonly device: FakeGpuDevice;
    readonly context: FakeCanvasContext;
    readonly surface: MemoryPixelPresenter;
    readonly errors: unknown[];
    readonly settingsEntity: Entity;
}

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

function postRig(postProcess: GpuPostProcessSettings | undefined, debug: boolean = true): PostRig {
    const world = debug ? new DebugWorld({platform: new MemoryPlatform()}) : new World({platform: new MemoryPlatform()});
    const errors: unknown[] = [];
    world.onStopped.add(event => errors.push(event.error));
    const device = new FakeGpuDevice();
    const canvas = new FakeCanvas();
    const context = new FakeCanvasContext(canvas, FORMAT);
    const gpu = new GpuDeviceResource(device, new GpuFrame(device, context, canvas, FORMAT));
    const surface = new MemoryPixelPresenter(SIZE);
    world.resources.insert(gpu);
    world.resources.insert(new PixelPresenterResource(new GpuCanvasPixelPresenter(surface, gpu, ignore)));
    world.entityManager.createEntity("camera", [new Camera(), new LocalToWorld(), new LocalPosition(), new FieldOfView()]);
    const meshSettings = Object.assign(new GpuMeshPassSettings(), {evictUnusedAfterFrames: EVICT_AFTER_FRAMES});
    const renderSettings = Object.assign(new PixelRenderSettings(), {backgroundColor: BACKGROUND});
    const settingsEntity = world.entityManager.createEntity("settings", postProcess === undefined ? [meshSettings, renderSettings] : [meshSettings, renderSettings, postProcess]);
    const mesh = quad();
    for (let i = 0; i < QUADS; i++) world.entityManager.createEntity("quad", [new RenderMesh(mesh), new LocalToWorld(), new LocalPosition(i, 0, QUAD_DISTANCE)]);
    world.getOrCreateSystem(GpuMeshPassSystem);
    return {world, device, context, surface, errors, settingsEntity};
}

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

async function step({world, device}: PostRig, times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
        world.step();
        device.queue.completeSubmittedWork();
        await nextTask();
    }
}

function lastSubmission(device: FakeGpuDevice): FakeRenderPass[] {
    return device.queue.submissions.at(-1)!.flatMap(buffer => [...buffer.passes]);
}

function attachment(pass: FakeRenderPass): GPURenderPassColorAttachment {
    return [...pass.descriptor.colorAttachments][0]!;
}

function textureOf(view: GPUTextureView | GPUTexture | GPUBindingResource | undefined): FakeGpuTexture {
    return (view as unknown as FakeGpuTextureView).texture;
}

function pipelineOf(pass: FakeRenderPass): GPURenderPipelineDescriptor {
    return pass.callsOf("setPipeline")[0].args[0] as GPURenderPipelineDescriptor;
}

function colorTargetOf(pipeline: GPURenderPipelineDescriptor): GPUColorTargetState {
    return [...pipeline.fragment!.targets][0]!;
}

function bindGroupOf(pass: FakeRenderPass): GPUBindGroupDescriptor {
    return pass.callsOf("setBindGroup").find(call => call.args[0] === POST_PROCESS_BIND_GROUP)!.args[1] as GPUBindGroupDescriptor;
}

function boundTexture(pass: FakeRenderPass, binding: number): FakeGpuTexture {
    return textureOf([...bindGroupOf(pass).entries].find(entry => entry.binding === binding)!.resource);
}

function sizeOf(texture: FakeGpuTexture): GPUExtent3D {
    return texture.descriptor.size;
}

function levelSize(level: number, size = SIZE): GPUExtent3D {
    return {width: bloomLevelPx(size.widthPx, level), height: bloomLevelPx(size.heightPx, level)};
}

function postTextures(device: FakeGpuDevice): FakeGpuTexture[] {
    return device.textures.filter(texture => texture.descriptor.label === HDR_SCENE_LABEL || texture.descriptor.label === BLOOM_LEVEL_LABEL);
}

function compositeConstants(device: FakeGpuDevice): Record<string, number> | undefined {
    return pipelineOf(lastSubmission(device).find(pass => pass.descriptor.label === COMPOSITE_PASS_LABEL)!).fragment!.constants as Record<string, number> | undefined;
}

function postUniformWrites(device: FakeGpuDevice): Float32Array[] {
    return device.queue.bufferWrites.filter(write => write.buffer.descriptor.label === POST_PROCESS_UNIFORMS_LABEL).map(write => write.data as Float32Array);
}

const EXPECTED_LEVELS = bloomLevelCountFor(new GpuPostProcessSettings().bloomMipLevels, SIZE.widthPx, SIZE.heightPx);
const SECOND_SMALLEST_LEVEL = EXPECTED_LEVELS - 2;

describe("GpuPostProcessSettings absent", () => {
    test("the scene is drawn as before: display lit pipelines without constants into the canvas format, no float targets, no post passes or resources", async () => {
        const rig = postRig(undefined);
        const {device, context} = rig;
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        expect(device.textures.map(texture => `${texture.descriptor.label}|${texture.descriptor.format}`).sort()).toEqual([
            `no shadow map|${SHADOW_MAP_FORMAT}`, `overlay|${OVERLAY_TEXTURE_FORMAT}`, `scene colour|${FORMAT}`, `scene depth|${DEPTH_FORMAT}`, `white|${MATERIAL_TEXTURE_FORMAT}`,
        ]);
        expect(device.pipelines.map(pipeline => [pipeline.label, colorTargetOf(pipeline).format, pipeline.fragment?.constants])).toEqual([
            ["overlay blended", FORMAT, undefined], ["overlay opaque", FORMAT, undefined], [DISPLAY_LIT_LABEL, FORMAT, undefined],
        ]);
        expect(device.pipelines.every(pipeline => !("constants" in pipeline.fragment!))).toBe(true);
        expect(device.shaderModules.map(module => module.label).sort()).toEqual([LIT_SURFACE_SHADER, OVERLAY.name].sort());
        expect(device.buffers.some(buffer => buffer.descriptor.label === POST_PROCESS_UNIFORMS_LABEL)).toBe(false);
        const passes = lastSubmission(device);
        expect(passes.map(pass => pass.descriptor.label)).toEqual(["scene", "overlay"]);
        expect(textureOf(attachment(passes[0]).resolveTarget)).toBe(context.currentTextures.at(-1)!);
        expect(pipelineOf(passes[0]).label).toBe(DISPLAY_LIT_LABEL);
    });
});

describe("GpuPostProcessSettings present", () => {
    test("the scene renders into an rgba16float target, then the bloom chain and the composite run in order before the overlay, in one submission", async () => {
        const rig = postRig(new GpuPostProcessSettings());
        const {device, context} = rig;
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        const passes = lastSubmission(device);
        expect(passes.map(pass => pass.descriptor.label)).toEqual([
            "scene",
            ...new Array(EXPECTED_LEVELS).fill(BLOOM_DOWNSAMPLE_PASS_LABEL),
            ...new Array(EXPECTED_LEVELS - 1).fill(BLOOM_UPSAMPLE_PASS_LABEL),
            COMPOSITE_PASS_LABEL,
            "overlay",
        ]);
        const scene = attachment(passes[0]);
        const hdr = textureOf(scene.resolveTarget);
        expect([textureOf(scene.view).descriptor.format, textureOf(scene.view).descriptor.sampleCount]).toEqual([HDR_SCENE_FORMAT, MULTISAMPLE_COUNT]);
        expect([hdr.descriptor.label, hdr.descriptor.format, sizeOf(hdr)]).toEqual([HDR_SCENE_LABEL, HDR_SCENE_FORMAT, {width: SIZE.widthPx, height: SIZE.heightPx}]);
        expect(scene.clearValue).toEqual(linearClearColorOf(BACKGROUND));
        const lit = pipelineOf(passes[0]);
        expect([lit.label, colorTargetOf(lit).format, lit.fragment!.constants]).toEqual([HDR_LIT_LABEL, HDR_SCENE_FORMAT, {[HDR_SCENE_OUTPUT_OVERRIDE]: OVERRIDE_ENABLED}]);

        const downsamples = passes.filter(pass => pass.descriptor.label === BLOOM_DOWNSAMPLE_PASS_LABEL);
        expect(downsamples.map(pass => pipelineOf(pass).label)).toEqual([
            BLOOM_PREFILTER_PIPELINE_LABEL, ...new Array(EXPECTED_LEVELS - 1).fill(BLOOM_DOWNSAMPLE_PIPELINE_LABEL),
        ]);
        expect(pipelineOf(downsamples[0]).fragment!.constants).toEqual({[BLOOM_PREFILTER_OVERRIDE]: OVERRIDE_ENABLED});
        expect(boundTexture(downsamples[0], POST_SOURCE_BINDING)).toBe(hdr);
        downsamples.forEach((pass, level) => {
            expect([sizeOf(textureOf(attachment(pass).view)), attachment(pass).loadOp]).toEqual([levelSize(level), "clear"]);
            if (level > 0) expect(sizeOf(boundTexture(pass, POST_SOURCE_BINDING))).toEqual(levelSize(level - 1));
        });
        const upsamples = passes.filter(pass => pass.descriptor.label === BLOOM_UPSAMPLE_PASS_LABEL);
        upsamples.forEach((pass, index) => {
            const level = SECOND_SMALLEST_LEVEL - index;
            expect([sizeOf(textureOf(attachment(pass).view)), attachment(pass).loadOp, pipelineOf(pass).label]).toEqual([levelSize(level), "load", BLOOM_UPSAMPLE_PIPELINE_LABEL]);
            expect(sizeOf(boundTexture(pass, POST_SOURCE_BINDING))).toEqual(levelSize(level + 1));
            expect(colorTargetOf(pipelineOf(pass)).blend?.color).toEqual({srcFactor: "one", dstFactor: "one", operation: "add"});
        });

        const composite = passes.find(pass => pass.descriptor.label === COMPOSITE_PASS_LABEL)!;
        expect(textureOf(attachment(composite).view)).toBe(context.currentTextures.at(-1)!);
        expect(boundTexture(composite, POST_SOURCE_BINDING)).toBe(hdr);
        expect(sizeOf(boundTexture(composite, POST_BLOOM_BINDING))).toEqual(levelSize(0));
        expect(colorTargetOf(pipelineOf(composite)).format).toBe(FORMAT);
        expect(compositeConstants(device)).toEqual({[TONE_MAPPING_OVERRIDE]: ACES_TONE_MAPPING_ID, [ENCODE_SRGB_OUTPUT_OVERRIDE]: OVERRIDE_ENABLED});
        expect(attachment(passes.at(-1)!).loadOp).toBe("load");
    });

    test("a custom surface shader draws through an HDR variant of its own pipeline", async () => {
        const rig = postRig(new GpuPostProcessSettings());
        const {world, device} = rig;
        world.resources.getOrCreate(GpuShaderLibrary).register(TOON, TOON_SOURCE);
        world.entityManager.createEntity("toon quad", [new RenderMesh(quad()), new LocalToWorld(), new LocalPosition(0, 0, QUAD_DISTANCE), new GpuSurfaceShader(TOON)]);
        await step(rig, SETTLE_STEPS + MORE_STEPS);
        expect(rig.errors).toEqual([]);
        const toon = device.asyncPipelines.filter(descriptor => descriptor.label?.startsWith(`${TOON}|`));
        expect(toon.map(descriptor => [descriptor.label, colorTargetOf(descriptor).format, descriptor.fragment!.constants])).toEqual([
            [`${TOON}|${FaceCulling.BackFaces}|${HDR_SCENE_FORMAT}|${MULTISAMPLE_COUNT}|${HDR_SCENE_OUTPUT}`, HDR_SCENE_FORMAT, {[HDR_SCENE_OUTPUT_OVERRIDE]: OVERRIDE_ENABLED}],
        ]);
        expect(lastSubmission(device)[0].callsOf("setPipeline").map(call => (call.args[0] as GPURenderPipelineDescriptor).label?.split("|")[0])).toEqual([LIT_SURFACE_SHADER, TOON]);
    });

    test("steady frames make no new targets, bind groups or pipelines; a resize remakes the targets; removing the settings releases them and draws with the display pipelines again", async () => {
        const rig = postRig(new GpuPostProcessSettings());
        const {world, device, surface, context} = rig;
        await step(rig, SETTLE_STEPS);
        const counts = () => [device.textures.length, device.bindGroups.length, device.pipelines.length, device.buffers.length];
        const settled = counts();
        await step(rig, MORE_STEPS);
        expect(counts()).toEqual(settled);
        expect(postTextures(device).length).toBe(1 + EXPECTED_LEVELS);

        surface.resize(RESIZED.widthPx, RESIZED.heightPx);
        await step(rig, SETTLE_STEPS);
        const resizedLevels = bloomLevelCountFor(new GpuPostProcessSettings().bloomMipLevels, RESIZED.widthPx, RESIZED.heightPx);
        const live = postTextures(device).filter(texture => !texture.destroyed);
        expect(live.map(sizeOf)).toEqual([
            {width: RESIZED.widthPx, height: RESIZED.heightPx}, ...Array.from({length: resizedLevels}, (_, level) => levelSize(level, RESIZED)),
        ]);
        expect(postTextures(device).length).toBe(1 + EXPECTED_LEVELS + 1 + resizedLevels);

        world.entityManager.removeComponent(rig.settingsEntity, GpuPostProcessSettings);
        await step(rig, SETTLE_STEPS);
        expect(rig.errors).toEqual([]);
        expect(postTextures(device).filter(texture => !texture.destroyed)).toEqual([]);
        const passes = lastSubmission(device);
        expect(passes.map(pass => pass.descriptor.label)).toEqual(["scene", "overlay"]);
        expect(textureOf(attachment(passes[0]).resolveTarget)).toBe(context.currentTextures.at(-1)!);
        expect(pipelineOf(passes[0]).label).toBe(DISPLAY_LIT_LABEL);
        expect(attachment(passes[0]).clearValue).toEqual(clearColorOf(BACKGROUND));
    });

    test("with bloom off or at zero intensity there are no bloom passes or levels, and the composite samples the 1x1 no-bloom texture", async () => {
        for (const settings of [Object.assign(new GpuPostProcessSettings(), {bloomEnabled: false}), Object.assign(new GpuPostProcessSettings(), {bloomIntensity: 0})]) {
            const rig = postRig(settings);
            await step(rig, SETTLE_STEPS);
            const passes = lastSubmission(rig.device);
            expect(passes.map(pass => pass.descriptor.label)).toEqual(["scene", COMPOSITE_PASS_LABEL, "overlay"]);
            const noBloom = boundTexture(passes[1], POST_BLOOM_BINDING);
            expect([noBloom.descriptor.label, sizeOf(noBloom)]).toEqual([NO_BLOOM_LABEL, ONE_TEXEL]);
            expect(rig.device.textures.some(texture => texture.descriptor.label === BLOOM_LEVEL_LABEL)).toBe(false);
        }
    });

    test("the tone mapping picks the composite variant, unknown names fall back to ACES, and exposure and bloom tuning reach the uniforms clamped at zero", async () => {
        const settings = Object.assign(new GpuPostProcessSettings(), {
            exposure: EXPOSURE, bloomIntensity: BLOOM_INTENSITY, bloomThreshold: BLOOM_THRESHOLD, bloomKnee: BLOOM_KNEE, toneMapping: AGX_TONE_MAPPING,
        });
        const rig = postRig(settings);
        await step(rig, SETTLE_STEPS);
        expect(compositeConstants(rig.device)?.[TONE_MAPPING_OVERRIDE]).toBe(AGX_TONE_MAPPING_ID);
        expect(Array.from(postUniformWrites(rig.device).at(-1)!)).toEqual([EXPOSURE, BLOOM_INTENSITY, BLOOM_THRESHOLD, BLOOM_KNEE].map(Math.fround));
        settings.toneMapping = REINHARD_TONE_MAPPING;
        await step(rig);
        expect(compositeConstants(rig.device)?.[TONE_MAPPING_OVERRIDE]).toBe(REINHARD_TONE_MAPPING_ID);
        Object.assign(settings, {toneMapping: UNKNOWN_TONE_MAPPING, exposure: NEGATIVE, bloomThreshold: NEGATIVE, bloomKnee: NEGATIVE});
        await step(rig);
        expect(compositeConstants(rig.device)?.[TONE_MAPPING_OVERRIDE]).toBe(ACES_TONE_MAPPING_ID);
        const uniforms = postUniformWrites(rig.device).at(-1)!;
        expect([uniforms[POST_EXPOSURE_OFFSET], uniforms[POST_BLOOM_INTENSITY_OFFSET], uniforms[POST_BLOOM_THRESHOLD_OFFSET], uniforms[POST_BLOOM_KNEE_OFFSET]])
            .toEqual([0, Math.fround(BLOOM_INTENSITY), 0, 0]);
        expect(rig.errors).toEqual([]);
    });

    test("destroying the world destroys every texture and buffer, the post-process ones included", async () => {
        const rig = postRig(new GpuPostProcessSettings(), false);
        await step(rig, SETTLE_STEPS);
        expect(postTextures(rig.device).length).toBeGreaterThan(0);
        rig.world.stop();
        expect(rig.device.liveTextures().map(texture => texture.descriptor.label)).toEqual([]);
        expect(rig.device.liveBuffers().map(buffer => buffer.descriptor.label)).toEqual([]);
    });
});

describe("GpuPostProcessPipelineCache", () => {
    function cache(device: FakeGpuDevice): GpuPostProcessPipelineCache {
        const layout = device.createPipelineLayout({bindGroupLayouts: []});
        return new GpuPostProcessPipelineCache(device, layout, layout);
    }

    test("one module and one pipeline per variant; an sRGB canvas skips the shader's own encoding", () => {
        const device = new FakeGpuDevice();
        const pipelines = cache(device);
        const aces = pipelines.compositePipeline(new GpuPostProcessSettings().toneMapping, FORMAT, FRAME);
        expect(pipelines.compositePipeline(new GpuPostProcessSettings().toneMapping, FORMAT, FRAME)).toBe(aces);
        pipelines.prefilterPipeline(FRAME);
        pipelines.downsamplePipeline(FRAME);
        pipelines.upsamplePipeline(FRAME);
        expect(pipelines.prefilterPipeline(FRAME)).toBe(pipelines.prefilterPipeline(FRAME));
        const srgb = pipelines.compositePipeline(new GpuPostProcessSettings().toneMapping, SRGB_FORMAT, FRAME) as unknown as GPURenderPipelineDescriptor;
        expect(srgb.fragment!.constants![ENCODE_SRGB_OUTPUT_OVERRIDE]).toBe(OVERRIDE_DISABLED);
        expect([canvasEncodesSrgb(SRGB_FORMAT), canvasEncodesSrgb(FORMAT)]).toEqual([true, false]);
        expect([pipelines.size, device.pipelines.length, device.shaderModules.map(module => module.label)]).toEqual([BLOOM_VARIANTS + COMPOSITE_VARIANTS, BLOOM_VARIANTS + COMPOSITE_VARIANTS, [POST_PROCESS_SHADER_NAME]]);
        const bloomPipelines = device.pipelines.filter(pipeline => !pipeline.label!.startsWith(COMPOSITE_PIPELINE_LABEL));
        expect(bloomPipelines.map(pipeline => colorTargetOf(pipeline).format)).toEqual(new Array(BLOOM_VARIANTS).fill(HDR_SCENE_FORMAT));
    });

    test("drops pipelines unused for more than the given frames and keeps the ones in use", () => {
        const device = new FakeGpuDevice();
        const pipelines = cache(device);
        pipelines.prefilterPipeline(FRAME);
        pipelines.upsamplePipeline(FRAME);
        pipelines.compositePipeline(REINHARD_TONE_MAPPING, FORMAT, FRAME);
        const evictionFrame = FRAME + EVICT_AFTER_FRAMES + 1;
        for (let frame = FRAME + 1; frame <= evictionFrame; frame++) {
            pipelines.compositePipeline(REINHARD_TONE_MAPPING, FORMAT, frame);
            pipelines.evictUnused(frame, EVICT_AFTER_FRAMES);
        }
        expect(pipelines.size).toBe(PIPELINES_IN_USE);
        pipelines.prefilterPipeline(evictionFrame);
        expect(device.pipelines.filter(pipeline => pipeline.label === BLOOM_PREFILTER_PIPELINE_LABEL).length).toBe(MADE_AGAIN);
    });
});
