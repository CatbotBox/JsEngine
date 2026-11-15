import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import type {GpuDevice, GpuShader} from "./gpuTypes";
import {DEPTH_FORMAT} from "./gpuFrame";
import {BASIC_LIT_VERTEX_BUFFERS} from "./shaders/basicLitShader";

export const SOFTWARE_FRONT_FACE: GPUFrontFace = "cw";
const NEARER_IS_GREATER_DEPTH: GPUCompareFunction = "greater";

export type GpuPipelineDevice = Pick<GpuDevice, "createShaderModule" | "createRenderPipeline">;

export function cullModeOf(culling: FaceCulling): GPUCullMode {
    switch (culling) {
        case FaceCulling.BackFaces:
            return "back";
        case FaceCulling.FrontFaces:
            return "front";
        case FaceCulling.None:
            return "none";
    }
}

export class GpuPipelineCache {
    private readonly pipelines = new Map<string, GPURenderPipeline>();
    private readonly modules = new Map<GpuShader, GPUShaderModule>();

    public constructor(private readonly device: GpuPipelineDevice, private readonly layout: GPUPipelineLayout) {
    }

    public get size(): number {
        return this.pipelines.size;
    }

    public pipelineFor(shader: GpuShader, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number): GPURenderPipeline {
        const key = `${shader.name}|${culling}|${format}|${sampleCount}`;
        let pipeline = this.pipelines.get(key);
        if (pipeline === undefined) {
            const module = this.moduleOf(shader);
            pipeline = this.device.createRenderPipeline({
                label: key,
                layout: this.layout,
                vertex: {module, entryPoint: shader.vertexEntryPoint, buffers: BASIC_LIT_VERTEX_BUFFERS},
                fragment: {module, entryPoint: shader.fragmentEntryPoint, targets: [{format}]},
                primitive: {topology: "triangle-list", cullMode: cullModeOf(culling), frontFace: SOFTWARE_FRONT_FACE},
                depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: NEARER_IS_GREATER_DEPTH},
                multisample: {count: sampleCount},
            });
            this.pipelines.set(key, pipeline);
        }
        return pipeline;
    }

    private moduleOf(shader: GpuShader): GPUShaderModule {
        let module = this.modules.get(shader);
        if (module === undefined) {
            module = this.device.createShaderModule({label: shader.name, code: shader.code});
            this.modules.set(shader, module);
        }
        return module;
    }
}
