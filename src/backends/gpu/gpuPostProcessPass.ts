import {asGpuBufferSource, GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {FLOAT_BYTES} from "./gpuLightPacking";
import {nonNegativeOrZero} from "./gpuShadowSettings";
import {ACES_TONE_MAPPING, toneMappingOf} from "./gpuPostProcessSettings";
import type {GpuPostProcessSettings, GpuToneMapping} from "./gpuPostProcessSettings";
import {HDR_SCENE_FORMAT} from "./gpuSceneOutput";
import type {GpuHdrSceneComposer, GpuHdrTargets, GpuPostProcessBindings} from "./gpuHdrTargets";
import {GpuPostProcessPipelineCache} from "./gpuPostProcessPipelineCache";
import {FULL_SCREEN_TRIANGLE_VERTICES} from "./shaders/overlayShader";
import {BLOOM_BIND_GROUP_LAYOUT, COMPOSITE_BIND_GROUP_LAYOUT, POST_PROCESS_BIND_GROUP} from "./shaders/postProcessLayout";
import {
    POST_BLOOM_INTENSITY_OFFSET,
    POST_BLOOM_KNEE_OFFSET,
    POST_BLOOM_THRESHOLD_OFFSET,
    POST_EXPOSURE_OFFSET,
    POST_PROCESS_UNIFORM_FLOATS,
} from "./shaders/postProcessShader";

export const BLOOM_DOWNSAMPLE_PASS_LABEL = "bloom downsample";
export const BLOOM_UPSAMPLE_PASS_LABEL = "bloom upsample";
export const COMPOSITE_PASS_LABEL = "post composite";
export const POST_PROCESS_UNIFORMS_LABEL = "post process uniforms";
export const NO_BLOOM_LABEL = "no bloom";
const NO_BLOOM_SIZE = 1;
const FIRST_BLOOM_LEVEL = 0;
const NEXT_LEVEL = 1;
const CLEARED: GPUColor = {r: 0, g: 0, b: 0, a: 0};
const CLEAR_TARGET: GPULoadOp = "clear";
const ADD_TO_TARGET: GPULoadOp = "load";
const POST_SAMPLER: GPUSamplerDescriptor = {
    label: "post process",
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
};

export type GpuPostProcessDevice = Pick<GpuDevice,
    "createBuffer" | "createTexture" | "createSampler" | "createBindGroupLayout" | "createPipelineLayout" | "createShaderModule" | "createRenderPipeline" | "queue">;

export class GpuPostProcessPass implements GpuHdrSceneComposer {
    private readonly bindings: GpuPostProcessBindings;
    private readonly noBloom: GPUTexture;
    private readonly pipelines: GpuPostProcessPipelineCache;
    private readonly uniforms = new Float32Array(POST_PROCESS_UNIFORM_FLOATS);
    private toneMapping: GpuToneMapping = ACES_TONE_MAPPING;
    private frame = 0;

    public constructor(private readonly device: GpuPostProcessDevice) {
        const bloomLayout = device.createBindGroupLayout(BLOOM_BIND_GROUP_LAYOUT);
        const compositeLayout = device.createBindGroupLayout(COMPOSITE_BIND_GROUP_LAYOUT);
        this.pipelines = new GpuPostProcessPipelineCache(
            device,
            device.createPipelineLayout({label: BLOOM_DOWNSAMPLE_PASS_LABEL, bindGroupLayouts: [bloomLayout]}),
            device.createPipelineLayout({label: COMPOSITE_PASS_LABEL, bindGroupLayouts: [compositeLayout]}),
        );
        this.noBloom = device.createTexture({
            label: NO_BLOOM_LABEL,
            size: {width: NO_BLOOM_SIZE, height: NO_BLOOM_SIZE},
            format: HDR_SCENE_FORMAT,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.bindings = {
            bloomLayout,
            compositeLayout,
            sampler: device.createSampler(POST_SAMPLER),
            uniformBuffer: device.createBuffer({
                label: POST_PROCESS_UNIFORMS_LABEL,
                size: POST_PROCESS_UNIFORM_FLOATS * FLOAT_BYTES,
                usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
            }),
            noBloomView: this.noBloom.createView(),
        };
    }

    public get pipelineCount(): number {
        return this.pipelines.size;
    }

    public prepare(settings: GpuPostProcessSettings, frame: number): this {
        this.frame = frame;
        this.toneMapping = toneMappingOf(settings);
        const uniforms = this.uniforms;
        uniforms[POST_EXPOSURE_OFFSET] = nonNegativeOrZero(settings.exposure);
        uniforms[POST_BLOOM_INTENSITY_OFFSET] = nonNegativeOrZero(settings.bloomIntensity);
        uniforms[POST_BLOOM_THRESHOLD_OFFSET] = nonNegativeOrZero(settings.bloomThreshold);
        uniforms[POST_BLOOM_KNEE_OFFSET] = nonNegativeOrZero(settings.bloomKnee);
        this.device.queue.writeBuffer(this.bindings.uniformBuffer, 0, asGpuBufferSource(uniforms));
        return this;
    }

    public compose(encoder: GPUCommandEncoder, targets: GpuHdrTargets, canvasView: GPUTextureView, canvasFormat: GPUTextureFormat): void {
        const bindings = this.bindings, pipelines = this.pipelines, frame = this.frame;
        const levels = targets.bloomLevelCount;
        if (levels > 0) {
            draw(encoder, BLOOM_DOWNSAMPLE_PASS_LABEL, targets.levelView(FIRST_BLOOM_LEVEL), CLEAR_TARGET,
                pipelines.prefilterPipeline(frame), targets.sceneSourceBindGroup(bindings));
            for (let level = FIRST_BLOOM_LEVEL + NEXT_LEVEL; level < levels; level++) {
                draw(encoder, BLOOM_DOWNSAMPLE_PASS_LABEL, targets.levelView(level), CLEAR_TARGET,
                    pipelines.downsamplePipeline(frame), targets.levelSourceBindGroup(bindings, level - NEXT_LEVEL));
            }
            const smallestLevel = levels - NEXT_LEVEL;
            for (let level = smallestLevel - NEXT_LEVEL; level >= FIRST_BLOOM_LEVEL; level--) {
                draw(encoder, BLOOM_UPSAMPLE_PASS_LABEL, targets.levelView(level), ADD_TO_TARGET,
                    pipelines.upsamplePipeline(frame), targets.levelSourceBindGroup(bindings, level + NEXT_LEVEL));
            }
        }
        draw(encoder, COMPOSITE_PASS_LABEL, canvasView, CLEAR_TARGET, pipelines.compositePipeline(this.toneMapping, canvasFormat, frame), targets.compositeBindGroup(bindings));
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        this.pipelines.evictUnused(frame, maxUnusedFrames);
    }

    public dispose(): void {
        this.noBloom.destroy();
        this.bindings.uniformBuffer.destroy();
    }
}

function draw(encoder: GPUCommandEncoder, label: string, target: GPUTextureView, loadOp: GPULoadOp, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup): void {
    const pass = encoder.beginRenderPass({
        label,
        colorAttachments: [{view: target, clearValue: CLEARED, loadOp, storeOp: "store"}],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(POST_PROCESS_BIND_GROUP, bindGroup);
    pass.draw(FULL_SCREEN_TRIANGLE_VERTICES);
    pass.end();
}
