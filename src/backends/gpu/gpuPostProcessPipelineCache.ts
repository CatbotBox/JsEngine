import type {GpuDevice} from "./gpuTypes";
import type {GpuToneMapping} from "./gpuPostProcessSettings";
import {HDR_SCENE_FORMAT, OVERRIDE_ENABLED} from "./gpuSceneOutput";
import {
    BLOOM_DOWNSAMPLE_ENTRY_POINT,
    BLOOM_PREFILTER_OVERRIDE,
    BLOOM_UPSAMPLE_ENTRY_POINT,
    COMPOSITE_ENTRY_POINT,
    ENCODE_SRGB_OUTPUT_OVERRIDE,
    FULL_SCREEN_VERTEX_ENTRY_POINT,
    POST_PROCESS_SHADER_NAME,
    POST_PROCESS_WGSL,
    TONE_MAPPING_OVERRIDE,
    toneMappingIdOf,
} from "./shaders/postProcessShader";

export const BLOOM_PREFILTER_PIPELINE_LABEL = "bloom prefilter";
export const BLOOM_DOWNSAMPLE_PIPELINE_LABEL = "bloom downsample";
export const BLOOM_UPSAMPLE_PIPELINE_LABEL = "bloom upsample";
export const COMPOSITE_PIPELINE_LABEL = "post composite";
const SRGB_FORMAT_SUFFIX = "-srgb";
const OVERRIDE_DISABLED = 0;

const ADDITIVE_BLENDING: GPUBlendState = {
    color: {srcFactor: "one", dstFactor: "one", operation: "add"},
    alpha: {srcFactor: "one", dstFactor: "one", operation: "add"},
};

export type GpuPostProcessPipelineDevice = Pick<GpuDevice, "createShaderModule" | "createRenderPipeline">;

interface CachedPipeline {
    readonly pipeline: GPURenderPipeline;
    lastUsedFrame: number;
}

export function canvasEncodesSrgb(format: GPUTextureFormat): boolean {
    return format.endsWith(SRGB_FORMAT_SUFFIX);
}

export class GpuPostProcessPipelineCache {
    private module: GPUShaderModule | undefined;
    private prefilter: CachedPipeline | undefined;
    private downsample: CachedPipeline | undefined;
    private upsample: CachedPipeline | undefined;
    private readonly composites = new Map<GPUTextureFormat, Map<GpuToneMapping, CachedPipeline>>();

    public constructor(
        private readonly device: GpuPostProcessPipelineDevice,
        private readonly bloomLayout: GPUPipelineLayout,
        private readonly compositeLayout: GPUPipelineLayout,
    ) {
    }

    public get size(): number {
        let size = (this.prefilter === undefined ? 0 : 1) + (this.downsample === undefined ? 0 : 1) + (this.upsample === undefined ? 0 : 1);
        for (const byToneMapping of this.composites.values()) size += byToneMapping.size;
        return size;
    }

    public prefilterPipeline(frame: number): GPURenderPipeline {
        this.prefilter ??= this.created(this.bloomDescriptor(BLOOM_PREFILTER_PIPELINE_LABEL, BLOOM_DOWNSAMPLE_ENTRY_POINT, {[BLOOM_PREFILTER_OVERRIDE]: OVERRIDE_ENABLED}, undefined), frame);
        return this.used(this.prefilter, frame);
    }

    public downsamplePipeline(frame: number): GPURenderPipeline {
        this.downsample ??= this.created(this.bloomDescriptor(BLOOM_DOWNSAMPLE_PIPELINE_LABEL, BLOOM_DOWNSAMPLE_ENTRY_POINT, {[BLOOM_PREFILTER_OVERRIDE]: OVERRIDE_DISABLED}, undefined), frame);
        return this.used(this.downsample, frame);
    }

    public upsamplePipeline(frame: number): GPURenderPipeline {
        this.upsample ??= this.created(this.bloomDescriptor(BLOOM_UPSAMPLE_PIPELINE_LABEL, BLOOM_UPSAMPLE_ENTRY_POINT, undefined, ADDITIVE_BLENDING), frame);
        return this.used(this.upsample, frame);
    }

    public compositePipeline(toneMapping: GpuToneMapping, format: GPUTextureFormat, frame: number): GPURenderPipeline {
        let byToneMapping = this.composites.get(format);
        if (byToneMapping === undefined) {
            byToneMapping = new Map();
            this.composites.set(format, byToneMapping);
        }
        let entry = byToneMapping.get(toneMapping);
        if (entry === undefined) {
            entry = this.created(this.compositeDescriptor(toneMapping, format), frame);
            byToneMapping.set(toneMapping, entry);
        }
        return this.used(entry, frame);
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        if (this.prefilter !== undefined && isStale(this.prefilter, frame, maxUnusedFrames)) this.prefilter = undefined;
        if (this.downsample !== undefined && isStale(this.downsample, frame, maxUnusedFrames)) this.downsample = undefined;
        if (this.upsample !== undefined && isStale(this.upsample, frame, maxUnusedFrames)) this.upsample = undefined;
        for (const [format, byToneMapping] of this.composites) {
            for (const [toneMapping, entry] of byToneMapping) {
                if (isStale(entry, frame, maxUnusedFrames)) byToneMapping.delete(toneMapping);
            }
            if (byToneMapping.size === 0) this.composites.delete(format);
        }
    }

    private created(descriptor: GPURenderPipelineDescriptor, frame: number): CachedPipeline {
        return {pipeline: this.device.createRenderPipeline(descriptor), lastUsedFrame: frame};
    }

    private used(entry: CachedPipeline, frame: number): GPURenderPipeline {
        entry.lastUsedFrame = frame;
        return entry.pipeline;
    }

    private shaderModule(): GPUShaderModule {
        return this.module ??= this.device.createShaderModule({label: POST_PROCESS_SHADER_NAME, code: POST_PROCESS_WGSL});
    }

    private bloomDescriptor(
        label: string, entryPoint: string, constants: Record<string, number> | undefined, blend: GPUBlendState | undefined,
    ): GPURenderPipelineDescriptor {
        const module = this.shaderModule();
        return {
            label,
            layout: this.bloomLayout,
            vertex: {module, entryPoint: FULL_SCREEN_VERTEX_ENTRY_POINT},
            fragment: {module, entryPoint, targets: [{format: HDR_SCENE_FORMAT, blend}], ...(constants === undefined ? {} : {constants})},
            primitive: {topology: "triangle-list"},
        };
    }

    private compositeDescriptor(toneMapping: GpuToneMapping, format: GPUTextureFormat): GPURenderPipelineDescriptor {
        const module = this.shaderModule();
        return {
            label: `${COMPOSITE_PIPELINE_LABEL}|${toneMapping}|${format}`,
            layout: this.compositeLayout,
            vertex: {module, entryPoint: FULL_SCREEN_VERTEX_ENTRY_POINT},
            fragment: {
                module,
                entryPoint: COMPOSITE_ENTRY_POINT,
                targets: [{format}],
                constants: {
                    [TONE_MAPPING_OVERRIDE]: toneMappingIdOf(toneMapping),
                    [ENCODE_SRGB_OUTPUT_OVERRIDE]: canvasEncodesSrgb(format) ? OVERRIDE_DISABLED : OVERRIDE_ENABLED,
                },
            },
            primitive: {topology: "triangle-list"},
        };
    }
}

function isStale(entry: CachedPipeline, frame: number, maxUnusedFrames: number): boolean {
    return frame - entry.lastUsedFrame > maxUnusedFrames;
}
