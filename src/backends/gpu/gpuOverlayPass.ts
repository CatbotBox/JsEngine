import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";
import type {PixelFrame} from "../pixels/pixelFrame";
import {asGpuBufferSource, GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {FULL_SCREEN_TRIANGLE_VERTICES, OVERLAY, OVERLAY_BIND_GROUP, OVERLAY_BIND_GROUP_LAYOUT, OVERLAY_SAMPLER_BINDING, OVERLAY_TEXTURE_BINDING} from "./shaders/overlayShader";

export const OVERLAY_TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";

const ALPHA_BLENDING: GPUBlendState = {
    color: {srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add"},
    alpha: {srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add"},
};

export type GpuOverlayDevice = Pick<GpuDevice,
    "createTexture" | "createSampler" | "createBindGroup" | "createBindGroupLayout" | "createPipelineLayout" | "createShaderModule" | "createRenderPipeline" | "queue">;

export class GpuOverlayPass {
    private readonly bindGroupLayout: GPUBindGroupLayout;
    private readonly sampler: GPUSampler;
    private readonly blendedPipeline: GPURenderPipeline;
    private readonly opaquePipeline: GPURenderPipeline;
    private texture: GPUTexture | undefined;
    private bindGroup: GPUBindGroup | undefined;
    private widthPx = 0;
    private heightPx = 0;

    public constructor(private readonly device: GpuOverlayDevice, format: GPUTextureFormat) {
        this.bindGroupLayout = device.createBindGroupLayout(OVERLAY_BIND_GROUP_LAYOUT);
        this.sampler = device.createSampler({label: "overlay", magFilter: "nearest", minFilter: "nearest"});
        const layout = device.createPipelineLayout({label: "overlay", bindGroupLayouts: [this.bindGroupLayout]});
        const module = device.createShaderModule({label: OVERLAY.name, code: OVERLAY.code});
        const pipeline = (blend: GPUBlendState | undefined): GPURenderPipeline => device.createRenderPipeline({
            label: blend === undefined ? "overlay opaque" : "overlay blended",
            layout,
            vertex: {module, entryPoint: OVERLAY.vertexEntryPoint},
            fragment: {module, entryPoint: OVERLAY.fragmentEntryPoint, targets: [{format, blend}]},
            primitive: {topology: "triangle-list"},
        });
        this.blendedPipeline = pipeline(ALPHA_BLENDING);
        this.opaquePipeline = pipeline(undefined);
    }

    public upload(frame: PixelFrame): void {
        const texture = this.textureOfSize(frame.widthPx, frame.heightPx);
        this.device.queue.writeTexture(
            {texture},
            asGpuBufferSource(frame.rgba),
            {bytesPerRow: frame.widthPx * RGBA_BYTES_PER_PIXEL, rowsPerImage: frame.heightPx},
            {width: frame.widthPx, height: frame.heightPx},
        );
    }

    public draw(pass: GPURenderPassEncoder, overScene: boolean): void {
        if (this.bindGroup === undefined) return;
        pass.setPipeline(overScene ? this.blendedPipeline : this.opaquePipeline);
        pass.setBindGroup(OVERLAY_BIND_GROUP, this.bindGroup);
        pass.draw(FULL_SCREEN_TRIANGLE_VERTICES);
    }

    public dispose(): void {
        this.texture?.destroy();
        this.texture = undefined;
        this.bindGroup = undefined;
    }

    private textureOfSize(widthPx: number, heightPx: number): GPUTexture {
        if (this.texture !== undefined && widthPx === this.widthPx && heightPx === this.heightPx) return this.texture;
        this.texture?.destroy();
        const texture = this.device.createTexture({
            label: "overlay",
            size: {width: widthPx, height: heightPx},
            format: OVERLAY_TEXTURE_FORMAT,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        this.texture = texture;
        this.widthPx = widthPx;
        this.heightPx = heightPx;
        this.bindGroup = this.device.createBindGroup({
            label: "overlay",
            layout: this.bindGroupLayout,
            entries: [
                {binding: OVERLAY_SAMPLER_BINDING, resource: this.sampler},
                {binding: OVERLAY_TEXTURE_BINDING, resource: texture.createView()},
            ],
        });
        return texture;
    }
}
