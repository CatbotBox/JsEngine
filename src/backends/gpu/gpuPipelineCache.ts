import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import type {GpuDevice, GpuShader} from "./gpuTypes";
import {DEPTH_FORMAT} from "./gpuFrame";
import {BASIC_LIT, BASIC_LIT_VERTEX_BUFFERS} from "./shaders/basicLitShader";

export const SOFTWARE_FRONT_FACE: GPUFrontFace = "cw";
const NEARER_IS_GREATER_DEPTH: GPUCompareFunction = "greater";
const VALIDATION_ERRORS: GPUErrorFilter = "validation";
const COMPILATION_ERROR: GPUCompilationMessageType = "error";
const FIRST_LINE_NUMBER = 1;

const SHADER_COMPILING = "compiling";
const SHADER_READY = "ready";
const SHADER_FAILED = "failed";
type CustomShaderState = typeof SHADER_COMPILING | typeof SHADER_READY | typeof SHADER_FAILED;

export type GpuPipelineDevice = Pick<GpuDevice, "createShaderModule" | "createRenderPipeline" | "createRenderPipelineAsync" | "pushErrorScope" | "popErrorScope">;

interface CustomShaderEntry {
    readonly shader: GpuShader;
    readonly module: GPUShaderModule;
    readonly pipelines: Map<string, GPURenderPipeline | undefined>;
    state: CustomShaderState;
}

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

export function surfaceShaderFailureMessage(shaderName: string, reason: string): string {
    return `GPU surface shader "${shaderName}" is drawn with the built-in lit shader instead: ${reason}`;
}

export function describeCompilationErrors(shader: GpuShader, messages: readonly GPUCompilationMessage[]): string {
    const lines = shader.code.split("\n");
    return messages.map(message => {
        const line = message.lineNum >= FIRST_LINE_NUMBER ? `\n    ${lines[message.lineNum - FIRST_LINE_NUMBER]?.trim() ?? ""}` : "";
        return `\nline ${message.lineNum}:${message.linePos}: ${message.message}${line}`;
    }).join("");
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function pipelineKey(culling: FaceCulling, format: GPUTextureFormat, sampleCount: number): string {
    return `${culling}|${format}|${sampleCount}`;
}

export class GpuPipelineCache {
    private readonly fallbackPipelines = new Map<string, GPURenderPipeline>();
    private fallbackModule: GPUShaderModule | undefined;
    private readonly customShaders = new Map<string, CustomShaderEntry>();

    public constructor(
        private readonly device: GpuPipelineDevice,
        private readonly layout: GPUPipelineLayout,
        private readonly fallback: GpuShader = BASIC_LIT,
    ) {
    }

    public get size(): number {
        let size = this.fallbackPipelines.size;
        for (const entry of this.customShaders.values()) {
            for (const pipeline of entry.pipelines.values()) if (pipeline !== undefined) size++;
        }
        return size;
    }

    public pipelineFor(shader: GpuShader, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number): GPURenderPipeline {
        if (shader !== this.fallback) {
            const custom = this.customPipelineFor(shader, culling, format, sampleCount);
            if (custom !== undefined) return custom;
        }
        return this.fallbackPipelineFor(culling, format, sampleCount);
    }

    private fallbackPipelineFor(culling: FaceCulling, format: GPUTextureFormat, sampleCount: number): GPURenderPipeline {
        const key = pipelineKey(culling, format, sampleCount);
        let pipeline = this.fallbackPipelines.get(key);
        if (pipeline === undefined) {
            this.fallbackModule ??= this.device.createShaderModule({label: this.fallback.name, code: this.fallback.code});
            pipeline = this.device.createRenderPipeline(this.descriptorFor(this.fallback, this.fallbackModule, key, culling, format, sampleCount));
            this.fallbackPipelines.set(key, pipeline);
        }
        return pipeline;
    }

    private customPipelineFor(shader: GpuShader, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number): GPURenderPipeline | undefined {
        const entry = this.customEntryFor(shader);
        if (entry.state !== SHADER_READY) return undefined;
        const key = pipelineKey(culling, format, sampleCount);
        if (entry.pipelines.has(key)) return entry.pipelines.get(key);
        entry.pipelines.set(key, undefined);
        this.device.createRenderPipelineAsync(this.descriptorFor(shader, entry.module, key, culling, format, sampleCount)).then(
            pipeline => entry.pipelines.set(key, pipeline),
            error => this.fail(entry, `its pipeline could not be created: ${messageOf(error)}`),
        );
        return undefined;
    }

    private customEntryFor(shader: GpuShader): CustomShaderEntry {
        const current = this.customShaders.get(shader.name);
        if (current !== undefined && current.shader === shader) return current;
        this.device.pushErrorScope(VALIDATION_ERRORS);
        const module = this.device.createShaderModule({label: shader.name, code: shader.code});
        const validation = this.device.popErrorScope();
        const entry: CustomShaderEntry = {shader, module, pipelines: new Map(), state: SHADER_COMPILING};
        this.customShaders.set(shader.name, entry);
        Promise.all([module.getCompilationInfo(), validation]).then(
            ([info, error]) => {
                const errors = info.messages.filter(message => message.type === COMPILATION_ERROR);
                if (errors.length > 0) this.fail(entry, `it does not compile:${describeCompilationErrors(shader, errors)}`);
                else if (error !== null) this.fail(entry, `its module is invalid: ${error.message}`);
                else entry.state = SHADER_READY;
            },
            error => this.fail(entry, messageOf(error)),
        );
        return entry;
    }

    private fail(entry: CustomShaderEntry, reason: string): void {
        if (entry.state === SHADER_FAILED) return;
        entry.state = SHADER_FAILED;
        if (this.customShaders.get(entry.shader.name) === entry) console.error(surfaceShaderFailureMessage(entry.shader.name, reason));
    }

    private descriptorFor(shader: GpuShader, module: GPUShaderModule, key: string, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number): GPURenderPipelineDescriptor {
        return {
            label: `${shader.name}|${key}`,
            layout: this.layout,
            vertex: {module, entryPoint: shader.vertexEntryPoint, buffers: BASIC_LIT_VERTEX_BUFFERS},
            fragment: {module, entryPoint: shader.fragmentEntryPoint, targets: [{format}]},
            primitive: {topology: "triangle-list", cullMode: cullModeOf(culling), frontFace: SOFTWARE_FRONT_FACE},
            depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: NEARER_IS_GREATER_DEPTH},
            multisample: {count: sampleCount},
        };
    }
}
