import type {Texture, TextureLevel} from "../../engine/rendering/3d/texture";
import {ALPHA_SHIFT, CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT, WHITE_RGB} from "../../engine/rendering/packedRgb";
import {RGBA_BYTES_PER_PIXEL} from "../pixels/pixelFrame";
import {asGpuBufferSource, GPU_TEXTURE_USAGE} from "./gpuTypes";
import type {GpuTextureDevice} from "./gpuTypes";

export const MATERIAL_TEXTURE_FORMAT: GPUTextureFormat = "rgba8unorm";
const RED_BYTE = 0, GREEN_BYTE = 1, BLUE_BYTE = 2, ALPHA_BYTE = 3;
const MIN_MIP_SIDE = 1;
const WHITE_TEXTURE_SIDE = 1;
const OPAQUE_WHITE_TEXEL = (CHANNEL_MAX << ALPHA_SHIFT) | WHITE_RGB;

export interface GpuTexture {
    readonly texture: GPUTexture;
    readonly view: GPUTextureView;
    lastUsedFrame: number;
}

export function packTextureLevel(level: TextureLevel): Uint8Array {
    const texels = level.texels;
    const bytes = new Uint8Array(texels.length * RGBA_BYTES_PER_PIXEL);
    for (let i = 0, o = 0; i < texels.length; i++, o += RGBA_BYTES_PER_PIXEL) {
        const texel = texels[i];
        bytes[o + RED_BYTE] = (texel >> RED_SHIFT) & CHANNEL_MASK;
        bytes[o + GREEN_BYTE] = (texel >> GREEN_SHIFT) & CHANNEL_MASK;
        bytes[o + BLUE_BYTE] = texel & CHANNEL_MASK;
        bytes[o + ALPHA_BYTE] = (texel >>> ALPHA_SHIFT) & CHANNEL_MASK;
    }
    return bytes;
}

function mipChainLength(levels: readonly TextureLevel[]): number {
    const {width, height} = levels[0];
    let count = 0;
    for (const level of levels) {
        if (level.width !== Math.max(MIN_MIP_SIDE, width >> count) || level.height !== Math.max(MIN_MIP_SIDE, height >> count)) break;
        count++;
    }
    return count;
}

export class GpuTextureCache {
    private readonly uploads = new Map<Texture, GpuTexture>();
    private white: GpuTexture | undefined;

    public constructor(private readonly device: GpuTextureDevice) {
    }

    public get size(): number {
        return this.uploads.size;
    }

    public ensure(texture: Texture | undefined, frame: number): GpuTexture {
        if (texture === undefined) return this.whiteTexture(frame);
        let uploaded = this.uploads.get(texture);
        if (uploaded === undefined) {
            uploaded = this.uploadLevels("material texture", texture.levels, frame);
            this.uploads.set(texture, uploaded);
        }
        uploaded.lastUsedFrame = frame;
        return uploaded;
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        for (const [texture, uploaded] of this.uploads) {
            if (frame - uploaded.lastUsedFrame <= maxUnusedFrames) continue;
            uploaded.texture.destroy();
            this.uploads.delete(texture);
        }
    }

    public dispose(): void {
        for (const uploaded of this.uploads.values()) uploaded.texture.destroy();
        this.uploads.clear();
        this.white?.texture.destroy();
        this.white = undefined;
    }

    private whiteTexture(frame: number): GpuTexture {
        if (this.white !== undefined) return this.white;
        const white: TextureLevel = {width: WHITE_TEXTURE_SIDE, height: WHITE_TEXTURE_SIDE, texels: new Int32Array([OPAQUE_WHITE_TEXEL])};
        return this.white = this.uploadLevels("white", [white], frame);
    }

    private uploadLevels(label: string, levels: readonly TextureLevel[], frame: number): GpuTexture {
        const mipLevelCount = mipChainLength(levels);
        const texture = this.device.createTexture({
            label,
            size: {width: levels[0].width, height: levels[0].height},
            format: MATERIAL_TEXTURE_FORMAT,
            mipLevelCount,
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        for (let mipLevel = 0; mipLevel < mipLevelCount; mipLevel++) {
            const level = levels[mipLevel];
            this.device.queue.writeTexture(
                {texture, mipLevel},
                asGpuBufferSource(packTextureLevel(level)),
                {bytesPerRow: level.width * RGBA_BYTES_PER_PIXEL, rowsPerImage: level.height},
                {width: level.width, height: level.height},
            );
        }
        return {texture, view: texture.createView(), lastUsedFrame: frame};
    }
}
