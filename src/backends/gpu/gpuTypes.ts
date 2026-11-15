/// <reference types="@webgpu/types" />

export const GPU_BUFFER_USAGE = {
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
} as const;

export const GPU_TEXTURE_USAGE = {
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    RENDER_ATTACHMENT: 0x10,
} as const;

export const GPU_SHADER_STAGE = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
} as const;

export type GpuQueue = Pick<GPUQueue, "writeBuffer" | "writeTexture" | "submit" | "onSubmittedWorkDone">;

export type GpuDevice = Pick<GPUDevice,
    | "createBuffer"
    | "createTexture"
    | "createSampler"
    | "createBindGroup"
    | "createBindGroupLayout"
    | "createPipelineLayout"
    | "createShaderModule"
    | "createRenderPipeline"
    | "createRenderPipelineAsync"
    | "pushErrorScope"
    | "popErrorScope"
    | "createCommandEncoder"> & {readonly queue: GpuQueue};

export type GpuBufferDevice = Pick<GpuDevice, "createBuffer" | "queue">;

export type GpuTextureDevice = Pick<GpuDevice, "createTexture" | "queue">;

export type GpuCanvasContext = Pick<GPUCanvasContext, "getCurrentTexture">;

export interface GpuCanvasSurface {
    width: number;
    height: number;
}

export interface GpuShader {
    readonly name: string;
    readonly code: string;
    readonly vertexEntryPoint: string;
    readonly fragmentEntryPoint: string;
}

export function asGpuBufferSource(view: ArrayBufferView): GPUAllowSharedBufferSource {
    return view as GPUAllowSharedBufferSource;
}
