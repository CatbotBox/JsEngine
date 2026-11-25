import {GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import {SHADOW_MAP_FARTHEST_DEPTH} from "./gpuShadowPacking";
import {SHADOW_MAP_FORMAT} from "./gpuShadowPipelineCache";
import {NO_SHADOW_MAP} from "./gpuShadowSettings";

export type ShadowMapArrayDimension = "2d-array" | "cube-array";

const NO_MAPS = 0;
const RENDERED_LAYERS = 1;
const RENDERED_LAYER_DIMENSION: GPUTextureViewDimension = "2d";
const NO_COLOR_ATTACHMENTS: readonly GPURenderPassColorAttachment[] = [];

export type GpuShadowMapDevice = Pick<GpuDevice, "createTexture">;

export class GpuShadowMapArray {
    private texture: GPUTexture | undefined;
    private view: GPUTextureView | undefined;
    private readonly passes: GPURenderPassDescriptor[] = [];
    private _size = NO_SHADOW_MAP;
    private _maps = NO_MAPS;
    private lastUsedFrame = 0;

    public constructor(
        private readonly device: GpuShadowMapDevice,
        private readonly label: string,
        private readonly dimension: ShadowMapArrayDimension,
        private readonly layersPerMap: number,
        private readonly passLabel: string,
    ) {
    }

    public viewUsedIn(frame: number): GPUTextureView | undefined {
        return this.lastUsedFrame === frame ? this.view : undefined;
    }

    public ensure(size: number, maps: number, maxMaps: number, frame: number): void {
        this.lastUsedFrame = frame;
        if (this.texture !== undefined && this._size === size && maps <= this._maps && this._maps <= maxMaps) return;
        this.destroy();
        this.allocate(size, maps);
    }

    public passFor(map: number, face: number): GPURenderPassDescriptor {
        return this.passes[map * this.layersPerMap + face];
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        if (this.texture !== undefined && frame - this.lastUsedFrame > maxUnusedFrames) this.destroy();
    }

    public destroy(): void {
        this.texture?.destroy();
        this.texture = undefined;
        this.view = undefined;
        this.passes.length = 0;
        this._size = NO_SHADOW_MAP;
        this._maps = NO_MAPS;
    }

    private allocate(size: number, maps: number): void {
        const layers = maps * this.layersPerMap;
        const texture = this.device.createTexture({
            label: this.label,
            size: {width: size, height: size, depthOrArrayLayers: layers},
            format: SHADOW_MAP_FORMAT,
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.texture = texture;
        this.view = texture.createView({label: this.label, dimension: this.dimension, arrayLayerCount: layers});
        for (let layer = 0; layer < layers; layer++) {
            this.passes.push({
                label: this.passLabel,
                colorAttachments: NO_COLOR_ATTACHMENTS,
                depthStencilAttachment: {
                    view: texture.createView({label: this.label, dimension: RENDERED_LAYER_DIMENSION, baseArrayLayer: layer, arrayLayerCount: RENDERED_LAYERS}),
                    depthClearValue: SHADOW_MAP_FARTHEST_DEPTH,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                },
            });
        }
        this._size = size;
        this._maps = maps;
    }
}
