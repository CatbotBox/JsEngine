import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";
import type {PixelFrame, PixelFrameDrawnTiles} from "../pixels/pixelFrame";
import {asGpuBufferSource, GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {GpuOverlayUploadPlan} from "./gpuOverlayUploadPlan";
import {FULL_SCREEN_TRIANGLE_VERTICES, OVERLAY, OVERLAY_BIND_GROUP, OVERLAY_BIND_GROUP_LAYOUT, OVERLAY_SAMPLER_BINDING, OVERLAY_TEXTURE_BINDING} from "./shaders/overlayShader";

export const OVERLAY_TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";

const SINGLE_ROW = 1;
const NO_TILES = 0;

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
    private readonly uploadPlan = new GpuOverlayUploadPlan();
    private textureHoldsTiles = false;
    private heldTileSizePx = NO_TILES;
    private heldColumns = NO_TILES;
    private heldRows = NO_TILES;
    private heldBackgroundPixel = 0;
    private heldDrawn = new Uint8Array(0);
    private dirtyTiles = new Uint8Array(0);
    private packedWords = new Uint32Array(0);
    private frameRgba: Uint8ClampedArray | undefined;
    private frameWords: Uint32Array | undefined;

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

    public upload(frame: PixelFrame): number {
        const texture = this.textureOfSize(frame.widthPx, frame.heightPx);
        const drawnTiles = frame.drawnTiles;
        const words = this.wordsOf(frame);
        const uploadedBytes = drawnTiles !== undefined && words !== undefined && this.holdsTilesLike(drawnTiles)
            ? this.uploadChangedTiles(texture, frame, drawnTiles, words)
            : this.uploadWholeFrame(texture, frame);
        this.holdTiles(drawnTiles);
        return uploadedBytes;
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
        this.textureHoldsTiles = false;
    }

    private uploadWholeFrame(texture: GPUTexture, frame: PixelFrame): number {
        this.device.queue.writeTexture(
            {texture},
            asGpuBufferSource(frame.rgba),
            {bytesPerRow: frame.widthPx * RGBA_BYTES_PER_PIXEL, rowsPerImage: frame.heightPx},
            {width: frame.widthPx, height: frame.heightPx},
        );
        return frame.widthPx * frame.heightPx * RGBA_BYTES_PER_PIXEL;
    }

    private uploadChangedTiles(texture: GPUTexture, frame: PixelFrame, drawnTiles: PixelFrameDrawnTiles, words: Uint32Array): number {
        const dirty = this.dirtyTilesOf(drawnTiles);
        const plan = this.uploadPlan;
        if (!plan.plan(dirty, drawnTiles.columns, drawnTiles.rows, drawnTiles.tileSizePx, frame.widthPx, frame.heightPx)) {
            return this.uploadWholeFrame(texture, frame);
        }
        for (let rect = 0; rect < plan.rectCount; rect++) {
            this.uploadRect(texture, frame, words, plan.rectLeft(rect), plan.rectTop(rect), plan.rectWidth(rect), plan.rectHeight(rect));
        }
        return plan.uploadBytes;
    }

    private uploadRect(texture: GPUTexture, frame: PixelFrame, words: Uint32Array, left: number, top: number, width: number, height: number): void {
        const frameWidth = frame.widthPx;
        const origin = {x: left, y: top};
        const size = {width, height};
        if (width === frameWidth || height === SINGLE_ROW) {
            const offset = (top * frameWidth + left) * RGBA_BYTES_PER_PIXEL;
            this.device.queue.writeTexture({texture, origin}, asGpuBufferSource(frame.rgba), {offset, bytesPerRow: frameWidth * RGBA_BYTES_PER_PIXEL, rowsPerImage: height}, size);
            return;
        }
        const packed = this.packedWordsFor(width * height);
        for (let row = 0; row < height; row++) {
            const start = (top + row) * frameWidth + left;
            packed.set(words.subarray(start, start + width), row * width);
        }
        this.device.queue.writeTexture({texture, origin}, asGpuBufferSource(packed), {bytesPerRow: width * RGBA_BYTES_PER_PIXEL, rowsPerImage: height}, size);
    }

    private dirtyTilesOf(drawnTiles: PixelFrameDrawnTiles): Uint8Array {
        const drawn = drawnTiles.drawn, held = this.heldDrawn;
        if (this.dirtyTiles.length !== drawn.length) this.dirtyTiles = new Uint8Array(drawn.length);
        const dirty = this.dirtyTiles;
        for (let tile = 0; tile < drawn.length; tile++) dirty[tile] = drawn[tile] | held[tile];
        return dirty;
    }

    private holdsTilesLike(drawnTiles: PixelFrameDrawnTiles): boolean {
        return this.textureHoldsTiles
            && drawnTiles.tileSizePx === this.heldTileSizePx
            && drawnTiles.columns === this.heldColumns
            && drawnTiles.rows === this.heldRows
            && drawnTiles.backgroundPixel === this.heldBackgroundPixel;
    }

    private holdTiles(drawnTiles: PixelFrameDrawnTiles | undefined): void {
        this.textureHoldsTiles = drawnTiles !== undefined;
        if (drawnTiles === undefined) return;
        this.heldTileSizePx = drawnTiles.tileSizePx;
        this.heldColumns = drawnTiles.columns;
        this.heldRows = drawnTiles.rows;
        this.heldBackgroundPixel = drawnTiles.backgroundPixel;
        if (this.heldDrawn.length !== drawnTiles.drawn.length) this.heldDrawn = new Uint8Array(drawnTiles.drawn.length);
        this.heldDrawn.set(drawnTiles.drawn);
    }

    private wordsOf(frame: PixelFrame): Uint32Array | undefined {
        const rgba = frame.rgba;
        if (rgba !== this.frameRgba) {
            this.frameRgba = rgba;
            this.frameWords = rgba.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0
                ? new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.length / RGBA_BYTES_PER_PIXEL)
                : undefined;
        }
        const words = this.frameWords;
        return words !== undefined && words.length === frame.widthPx * frame.heightPx ? words : undefined;
    }

    private packedWordsFor(wordCount: number): Uint32Array {
        if (this.packedWords.length < wordCount) this.packedWords = new Uint32Array(wordCount);
        return this.packedWords;
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
        this.textureHoldsTiles = false;
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
