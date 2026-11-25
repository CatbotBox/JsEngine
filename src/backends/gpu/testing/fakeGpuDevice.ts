import type {GpuCanvasContext, GpuCanvasSurface, GpuDevice, GpuQueue} from "../gpuTypes";

type CopyableView = ArrayBufferView & {readonly length: number; slice(start?: number, end?: number): ArrayBufferView};

export class FakeGpuBuffer {
    public destroyed = false;

    public constructor(public readonly descriptor: GPUBufferDescriptor) {
    }

    public get size(): number {
        return this.descriptor.size;
    }

    public destroy(): undefined {
        this.destroyed = true;
        return undefined;
    }
}

export type CompilationMessages = (code: string) => readonly GPUCompilationMessage[];
export type PipelineCreationFailure = (descriptor: GPURenderPipelineDescriptor) => string | undefined;

const NO_COMPILATION_MESSAGES: CompilationMessages = () => [];
const PIPELINES_ALWAYS_CREATED: PipelineCreationFailure = () => undefined;
const COMPILATION_ERROR: GPUCompilationMessageType = "error";

export function compilationError(message: string, lineNum: number, linePos: number): GPUCompilationMessage {
    return {message, type: COMPILATION_ERROR, lineNum, linePos, offset: 0, length: 0} as GPUCompilationMessage;
}

export class FakeGpuShaderModule {
    public constructor(public readonly descriptor: GPUShaderModuleDescriptor, public readonly messages: readonly GPUCompilationMessage[]) {
    }

    public get hasErrors(): boolean {
        return this.messages.some(message => message.type === COMPILATION_ERROR);
    }

    public getCompilationInfo(): Promise<GPUCompilationInfo> {
        return Promise.resolve({messages: this.messages} as unknown as GPUCompilationInfo);
    }
}

export class FakeGpuError {
    public constructor(public readonly message: string) {
    }
}

export class FakeGpuTextureView {
    public constructor(public readonly texture: FakeGpuTexture, public readonly descriptor: GPUTextureViewDescriptor = {}) {
    }
}

export class FakeGpuTexture {
    public destroyed = false;

    public constructor(public readonly descriptor: GPUTextureDescriptor) {
    }

    public createView(descriptor: GPUTextureViewDescriptor = {}): GPUTextureView {
        return new FakeGpuTextureView(this, descriptor) as unknown as GPUTextureView;
    }

    public destroy(): undefined {
        this.destroyed = true;
        return undefined;
    }
}

export interface RecordedCall {
    readonly method: string;
    readonly args: readonly unknown[];
}

export class FakeRenderPass {
    public readonly calls: RecordedCall[] = [];
    public ended = false;

    public constructor(public readonly descriptor: GPURenderPassDescriptor) {
    }

    public callsOf(method: string): RecordedCall[] {
        return this.calls.filter(call => call.method === method);
    }

    public setPipeline(...args: unknown[]): undefined {
        return this.record("setPipeline", args);
    }

    public setBindGroup(...args: unknown[]): undefined {
        return this.record("setBindGroup", args);
    }

    public setVertexBuffer(...args: unknown[]): undefined {
        return this.record("setVertexBuffer", args);
    }

    public setIndexBuffer(...args: unknown[]): undefined {
        return this.record("setIndexBuffer", args);
    }

    public draw(...args: unknown[]): undefined {
        return this.record("draw", args);
    }

    public drawIndexed(...args: unknown[]): undefined {
        return this.record("drawIndexed", args);
    }

    public end(): undefined {
        this.ended = true;
        return undefined;
    }

    private record(method: string, args: unknown[]): undefined {
        this.calls.push({method, args});
        return undefined;
    }
}

export class FakeCommandBuffer {
    public constructor(public readonly passes: readonly FakeRenderPass[]) {
    }
}

export class FakeCommandEncoder {
    public readonly passes: FakeRenderPass[] = [];
    public finished = false;

    public beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder {
        const pass = new FakeRenderPass(descriptor);
        this.passes.push(pass);
        return pass as unknown as GPURenderPassEncoder;
    }

    public finish(): GPUCommandBuffer {
        this.finished = true;
        return new FakeCommandBuffer(this.passes) as unknown as GPUCommandBuffer;
    }
}

export interface RecordedBufferWrite {
    readonly buffer: FakeGpuBuffer;
    readonly bufferOffset: number;
    readonly data: ArrayBufferView;
}

export interface RecordedTextureWrite {
    readonly destination: GPUTexelCopyTextureInfo;
    readonly texture: FakeGpuTexture;
    readonly data: ArrayBufferView;
    readonly layout: GPUTexelCopyBufferLayout;
    readonly size: GPUExtent3DStrict;
}

export class FakeGpuQueue implements GpuQueue {
    public readonly bufferWrites: RecordedBufferWrite[] = [];
    public readonly textureWrites: RecordedTextureWrite[] = [];
    public readonly submissions: FakeCommandBuffer[][] = [];
    private readonly pendingWork: (() => void)[] = [];

    public get unfinishedSubmissions(): number {
        return this.pendingWork.length;
    }

    public writeBuffer(buffer: GPUBuffer, bufferOffset: GPUSize64, data: GPUAllowSharedBufferSource, dataOffset?: GPUSize64, size?: GPUSize64): undefined {
        const view = data as unknown as CopyableView;
        const start = dataOffset ?? 0;
        const end = size === undefined ? view.length : start + size;
        this.bufferWrites.push({buffer: buffer as unknown as FakeGpuBuffer, bufferOffset, data: view.slice(start, end)});
        return undefined;
    }

    public writeTexture(destination: GPUTexelCopyTextureInfo, data: GPUAllowSharedBufferSource, layout: GPUTexelCopyBufferLayout, size: GPUExtent3DStrict): undefined {
        const view = data as unknown as CopyableView;
        this.textureWrites.push({destination, texture: destination.texture as unknown as FakeGpuTexture, data: view.slice(), layout, size});
        return undefined;
    }

    public submit(commandBuffers: Iterable<GPUCommandBuffer>): undefined {
        this.submissions.push([...commandBuffers] as unknown as FakeCommandBuffer[]);
        return undefined;
    }

    public onSubmittedWorkDone(): Promise<undefined> {
        return new Promise(resolve => this.pendingWork.push(() => resolve(undefined)));
    }

    public completeSubmittedWork(): void {
        for (const complete of this.pendingWork.splice(0)) complete();
    }

    public writesTo(buffer: GPUBuffer | FakeGpuBuffer): RecordedBufferWrite[] {
        return this.bufferWrites.filter(write => write.buffer === buffer);
    }
}

export class FakeGpuDevice implements GpuDevice {
    public readonly queue = new FakeGpuQueue();
    public readonly buffers: FakeGpuBuffer[] = [];
    public readonly textures: FakeGpuTexture[] = [];
    public readonly samplers: GPUSamplerDescriptor[] = [];
    public readonly bindGroups: GPUBindGroupDescriptor[] = [];
    public readonly bindGroupLayouts: GPUBindGroupLayoutDescriptor[] = [];
    public readonly pipelineLayouts: GPUPipelineLayoutDescriptor[] = [];
    public readonly shaderModules: GPUShaderModuleDescriptor[] = [];
    public readonly pipelines: GPURenderPipelineDescriptor[] = [];
    public readonly asyncPipelines: GPURenderPipelineDescriptor[] = [];
    public readonly encoders: FakeCommandEncoder[] = [];
    public compilationMessages: CompilationMessages = NO_COMPILATION_MESSAGES;
    public pipelineCreationFailure: PipelineCreationFailure = PIPELINES_ALWAYS_CREATED;
    private readonly errorScopes: (FakeGpuError | null)[] = [];

    public createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
        const buffer = new FakeGpuBuffer(descriptor);
        this.buffers.push(buffer);
        return buffer as unknown as GPUBuffer;
    }

    public createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
        const texture = new FakeGpuTexture(descriptor);
        this.textures.push(texture);
        return texture as unknown as GPUTexture;
    }

    public createSampler(descriptor: GPUSamplerDescriptor = {}): GPUSampler {
        this.samplers.push(descriptor);
        return descriptor as unknown as GPUSampler;
    }

    public createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup {
        this.bindGroups.push(descriptor);
        return descriptor as unknown as GPUBindGroup;
    }

    public createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
        this.bindGroupLayouts.push(descriptor);
        return descriptor as unknown as GPUBindGroupLayout;
    }

    public createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
        this.pipelineLayouts.push(descriptor);
        return descriptor as unknown as GPUPipelineLayout;
    }

    public createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
        this.shaderModules.push(descriptor);
        const module = new FakeGpuShaderModule(descriptor, this.compilationMessages(descriptor.code));
        if (module.hasErrors && this.errorScopes.length > 0 && this.errorScopes.at(-1) === null) {
            this.errorScopes[this.errorScopes.length - 1] = new FakeGpuError(`Invalid ShaderModule "${descriptor.label}"`);
        }
        return module as unknown as GPUShaderModule;
    }

    public createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
        this.pipelines.push(descriptor);
        return descriptor as unknown as GPURenderPipeline;
    }

    public createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor): Promise<GPURenderPipeline> {
        this.asyncPipelines.push(descriptor);
        const failure = this.pipelineCreationFailure(descriptor);
        if (failure !== undefined) return Promise.reject(new Error(failure));
        this.pipelines.push(descriptor);
        return Promise.resolve(descriptor as unknown as GPURenderPipeline);
    }

    public pushErrorScope(_filter: GPUErrorFilter): undefined {
        this.errorScopes.push(null);
        return undefined;
    }

    public popErrorScope(): Promise<GPUError | null> {
        if (this.errorScopes.length === 0) return Promise.reject(new Error("popErrorScope without a pushed scope"));
        return Promise.resolve(this.errorScopes.pop() as unknown as GPUError | null);
    }

    public createCommandEncoder(): GPUCommandEncoder {
        const encoder = new FakeCommandEncoder();
        this.encoders.push(encoder);
        return encoder as unknown as GPUCommandEncoder;
    }

    public get submittedPasses(): FakeRenderPass[] {
        return this.queue.submissions.flat().flatMap(buffer => [...buffer.passes]);
    }

    public liveBuffers(): FakeGpuBuffer[] {
        return this.buffers.filter(buffer => !buffer.destroyed);
    }

    public liveTextures(): FakeGpuTexture[] {
        return this.textures.filter(texture => !texture.destroyed);
    }
}

export class FakeCanvas implements GpuCanvasSurface {
    public constructor(public width: number = 0, public height: number = 0) {
    }
}

export class FakeCanvasContext implements GpuCanvasContext {
    public readonly currentTextures: FakeGpuTexture[] = [];

    public constructor(private readonly canvas: GpuCanvasSurface, private readonly format: GPUTextureFormat) {
    }

    public getCurrentTexture(): GPUTexture {
        const texture = new FakeGpuTexture({size: {width: this.canvas.width, height: this.canvas.height}, format: this.format, usage: 0});
        this.currentTextures.push(texture);
        return texture as unknown as GPUTexture;
    }
}
