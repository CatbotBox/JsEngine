import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import type {GpuDevice, GpuShader} from "./gpuTypes";
import {DEPTH_FORMAT} from "./gpuFrame";
import {DISPLAY_SCENE_OUTPUT, OVERRIDE_ENABLED} from "./gpuSceneOutput";
import type {GpuSceneOutput} from "./gpuSceneOutput";
import {BASIC_LIT, BASIC_LIT_VERTEX_BUFFERS, HDR_SCENE_OUTPUT_OVERRIDE} from "./shaders/basicLitShader";

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

interface FrameStamped {
    lastUsedFrame: number;
}

interface FallbackPipeline extends FrameStamped {
    readonly pipeline: GPURenderPipeline;
}

interface CustomPipeline extends FrameStamped {
    pipeline: GPURenderPipeline | undefined;
}

interface CustomShaderEntry extends FrameStamped {
    readonly shader: GpuShader;
    readonly module: GPUShaderModule;
    readonly pipelines: Map<string, CustomPipeline>;
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

function pipelineKey(culling: FaceCulling, format: GPUTextureFormat, sampleCount: number, output: GpuSceneOutput): string {
    const displayKey = `${culling}|${format}|${sampleCount}`;
    return output === DISPLAY_SCENE_OUTPUT ? displayKey : `${displayKey}|${output}`;
}

function fragmentConstantsOf(output: GpuSceneOutput): Pick<GPUFragmentState, "constants"> {
    return output === DISPLAY_SCENE_OUTPUT ? {} : {constants: {[HDR_SCENE_OUTPUT_OVERRIDE]: OVERRIDE_ENABLED}};
}

function isStale(entry: FrameStamped, frame: number, maxUnusedFrames: number): boolean {
    return frame - entry.lastUsedFrame > maxUnusedFrames;
}

function evictStale<T extends FrameStamped>(entries: Map<string, T>, frame: number, maxUnusedFrames: number): void {
    for (const [key, entry] of entries) {
        if (isStale(entry, frame, maxUnusedFrames)) entries.delete(key);
    }
}

export class GpuPipelineCache {
    private readonly fallbackPipelines = new Map<string, FallbackPipeline>();
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
            for (const custom of entry.pipelines.values()) if (custom.pipeline !== undefined) size++;
        }
        return size;
    }

    public pipelineFor(
        shader: GpuShader, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number, frame: number, output: GpuSceneOutput = DISPLAY_SCENE_OUTPUT,
    ): GPURenderPipeline | undefined {
        if (shader === this.fallback) return this.fallbackPipelineFor(culling, format, sampleCount, output, frame);
        const entry = this.customEntryFor(shader, frame);
        switch (entry.state) {
            case SHADER_FAILED:
                return this.fallbackPipelineFor(culling, format, sampleCount, output, frame);
            case SHADER_COMPILING:
                return undefined;
            case SHADER_READY:
                return this.customPipelineFor(entry, culling, format, sampleCount, output, frame);
        }
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        evictStale(this.fallbackPipelines, frame, maxUnusedFrames);
        for (const [name, entry] of this.customShaders) {
            if (isStale(entry, frame, maxUnusedFrames)) this.customShaders.delete(name);
            else evictStale(entry.pipelines, frame, maxUnusedFrames);
        }
    }

    private fallbackPipelineFor(culling: FaceCulling, format: GPUTextureFormat, sampleCount: number, output: GpuSceneOutput, frame: number): GPURenderPipeline {
        const key = pipelineKey(culling, format, sampleCount, output);
        let fallback = this.fallbackPipelines.get(key);
        if (fallback === undefined) {
            this.fallbackModule ??= this.device.createShaderModule({label: this.fallback.name, code: this.fallback.code});
            const pipeline = this.device.createRenderPipeline(this.descriptorFor(this.fallback, this.fallbackModule, key, culling, format, sampleCount, output));
            fallback = {pipeline, lastUsedFrame: frame};
            this.fallbackPipelines.set(key, fallback);
        }
        fallback.lastUsedFrame = frame;
        return fallback.pipeline;
    }

    private customPipelineFor(
        entry: CustomShaderEntry, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number, output: GpuSceneOutput, frame: number,
    ): GPURenderPipeline | undefined {
        const key = pipelineKey(culling, format, sampleCount, output);
        let custom = entry.pipelines.get(key);
        if (custom === undefined) {
            const created: CustomPipeline = {pipeline: undefined, lastUsedFrame: frame};
            entry.pipelines.set(key, created);
            this.device.createRenderPipelineAsync(this.descriptorFor(entry.shader, entry.module, key, culling, format, sampleCount, output)).then(
                pipeline => created.pipeline = pipeline,
                error => this.fail(entry, `its pipeline could not be created: ${messageOf(error)}`),
            );
            custom = created;
        }
        custom.lastUsedFrame = frame;
        return custom.pipeline;
    }

    private customEntryFor(shader: GpuShader, frame: number): CustomShaderEntry {
        const current = this.customShaders.get(shader.name);
        if (current !== undefined && current.shader === shader) {
            current.lastUsedFrame = frame;
            return current;
        }
        this.device.pushErrorScope(VALIDATION_ERRORS);
        const module = this.device.createShaderModule({label: shader.name, code: shader.code});
        const validation = this.device.popErrorScope();
        const entry: CustomShaderEntry = {shader, module, pipelines: new Map(), state: SHADER_COMPILING, lastUsedFrame: frame};
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

    private descriptorFor(
        shader: GpuShader, module: GPUShaderModule, key: string, culling: FaceCulling, format: GPUTextureFormat, sampleCount: number, output: GpuSceneOutput,
    ): GPURenderPipelineDescriptor {
        return {
            label: `${shader.name}|${key}`,
            layout: this.layout,
            vertex: {module, entryPoint: shader.vertexEntryPoint, buffers: BASIC_LIT_VERTEX_BUFFERS},
            fragment: {module, entryPoint: shader.fragmentEntryPoint, targets: [{format}], ...fragmentConstantsOf(output)},
            primitive: {topology: "triangle-list", cullMode: cullModeOf(culling), frontFace: SOFTWARE_FRONT_FACE},
            depthStencil: {format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: NEARER_IS_GREATER_DEPTH},
            multisample: {count: sampleCount},
        };
    }
}
