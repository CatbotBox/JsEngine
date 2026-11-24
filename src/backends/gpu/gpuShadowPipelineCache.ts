import type {GpuDevice} from "./gpuTypes";
import {SOFTWARE_FRONT_FACE} from "./gpuPipelineCache";
import {SHADOW_CASTER_SHADER_NAME, SHADOW_CASTER_VERTEX_BUFFERS, SHADOW_CASTER_VERTEX_ENTRY_POINT, SHADOW_CASTER_WGSL} from "./shaders/shadowCasterShader";

export const SHADOW_MAP_FORMAT: GPUTextureFormat = "depth32float";
export const SHADOW_CASTER_CULL_MODE: GPUCullMode = "none";
const NEARER_IS_LESS_DEPTH: GPUCompareFunction = "less";
const NO_CONSTANT_DEPTH_BIAS = 0;
const UNCLAMPED_DEPTH_BIAS = 0;

export type GpuShadowPipelineDevice = Pick<GpuDevice, "createShaderModule" | "createRenderPipeline">;

interface CasterPipeline {
    readonly pipeline: GPURenderPipeline;
    lastUsedFrame: number;
}

export class GpuShadowPipelineCache {
    private readonly pipelines = new Map<number, CasterPipeline>();
    private module: GPUShaderModule | undefined;

    public constructor(private readonly device: GpuShadowPipelineDevice, private readonly layout: GPUPipelineLayout) {
    }

    public get size(): number {
        return this.pipelines.size;
    }

    public pipelineFor(slopeBias: number, frame: number): GPURenderPipeline {
        let entry = this.pipelines.get(slopeBias);
        if (entry === undefined) {
            this.module ??= this.device.createShaderModule({label: SHADOW_CASTER_SHADER_NAME, code: SHADOW_CASTER_WGSL});
            entry = {pipeline: this.device.createRenderPipeline(this.descriptorFor(this.module, slopeBias)), lastUsedFrame: frame};
            this.pipelines.set(slopeBias, entry);
        }
        entry.lastUsedFrame = frame;
        return entry.pipeline;
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        for (const [slopeBias, entry] of this.pipelines) {
            if (frame - entry.lastUsedFrame > maxUnusedFrames) this.pipelines.delete(slopeBias);
        }
    }

    private descriptorFor(module: GPUShaderModule, slopeBias: number): GPURenderPipelineDescriptor {
        return {
            label: `${SHADOW_CASTER_SHADER_NAME}|${SHADOW_CASTER_CULL_MODE}|${SHADOW_MAP_FORMAT}|${slopeBias}`,
            layout: this.layout,
            vertex: {module, entryPoint: SHADOW_CASTER_VERTEX_ENTRY_POINT, buffers: SHADOW_CASTER_VERTEX_BUFFERS},
            primitive: {topology: "triangle-list", cullMode: SHADOW_CASTER_CULL_MODE, frontFace: SOFTWARE_FRONT_FACE},
            depthStencil: {
                format: SHADOW_MAP_FORMAT,
                depthWriteEnabled: true,
                depthCompare: NEARER_IS_LESS_DEPTH,
                depthBias: NO_CONSTANT_DEPTH_BIAS,
                depthBiasSlopeScale: slopeBias,
                depthBiasClamp: UNCLAMPED_DEPTH_BIAS,
            },
        };
    }
}
