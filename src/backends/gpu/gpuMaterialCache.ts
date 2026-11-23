import type {Material} from "../../engine/rendering/3d/material";
import type {Texture} from "../../engine/rendering/3d/texture";
import {CHANNEL_MASK, CHANNEL_MAX, GREEN_SHIFT, RED_SHIFT} from "../../engine/rendering/packedRgb";
import {asGpuBufferSource, GPU_BUFFER_USAGE} from "./gpuTypes";
import type {GpuDevice} from "./gpuTypes";
import type {GpuTexture, GpuTextureCache} from "./gpuTextureCache";
import {FLOAT_BYTES} from "./gpuLightPacking";
import {LINEAR_TEXTURE_FILTERING} from "./gpuMeshPassSettings";
import type {GpuTextureFiltering} from "./gpuMeshPassSettings";
import {
    MATERIAL_DIFFUSE_OFFSET,
    MATERIAL_EMISSIVE_OFFSET,
    MATERIAL_SAMPLER_BINDING,
    MATERIAL_SHININESS_OFFSET,
    MATERIAL_SPECULAR_CUTOFF_OFFSET,
    MATERIAL_SPECULAR_OFFSET,
    MATERIAL_SPECULAR_TEXTURE_BINDING,
    MATERIAL_TEXTURE_BINDING,
    MATERIAL_TEXTURED,
    MATERIAL_TEXTURED_OFFSET,
    MATERIAL_UNIFORM_FLOATS,
    MATERIAL_UNIFORMS_BINDING,
    MATERIAL_UNTEXTURED,
} from "./shaders/basicLitShader";

const OPAQUE_ALPHA = 1;
const NO_SPECULAR_COLOR = 0;
const NEGLIGIBLE_SPECULAR = 0.005;
const NO_SPECULAR_CUTOFF = 2;

export type GpuMaterialDevice = Pick<GpuDevice, "createBuffer" | "createBindGroup" | "createSampler" | "queue">;

export interface GpuMaterial {
    readonly uniformBuffer: GPUBuffer;
    readonly bindGroup: GPUBindGroup;
}

interface MaterialEntry extends GpuMaterial {
    bindGroup: GPUBindGroup;
    boundTexture: Texture | undefined;
    boundSpecularTexture: Texture | undefined;
    boundSampler: GPUSampler;
    diffuseUpload: GpuTexture;
    specularUpload: GpuTexture;
    readonly written: Float32Array;
    lastUsedFrame: number;
}

interface MaterialBinding {
    readonly bindGroup: GPUBindGroup;
    readonly diffuseUpload: GpuTexture;
    readonly specularUpload: GpuTexture;
}

function writeRgb(out: Float32Array, offset: number, rgb: number): void {
    out[offset] = ((rgb >> RED_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX;
    out[offset + 1] = ((rgb >> GREEN_SHIFT) & CHANNEL_MASK) / CHANNEL_MAX;
    out[offset + 2] = (rgb & CHANNEL_MASK) / CHANNEL_MAX;
}

export function specularCutoffOf(material: Material): number {
    return material.specularColor === NO_SPECULAR_COLOR ? NO_SPECULAR_CUTOFF : Math.pow(NEGLIGIBLE_SPECULAR, 1 / material.shininess);
}

export function packMaterial(material: Material, texturesEnabled: boolean, out: Float32Array): void {
    out.fill(0);
    writeRgb(out, MATERIAL_DIFFUSE_OFFSET, material.diffuseColor);
    out[MATERIAL_DIFFUSE_OFFSET + 3] = OPAQUE_ALPHA;
    writeRgb(out, MATERIAL_EMISSIVE_OFFSET, material.emissiveColor);
    writeRgb(out, MATERIAL_SPECULAR_OFFSET, material.specularColor);
    out[MATERIAL_SHININESS_OFFSET] = material.shininess;
    out[MATERIAL_TEXTURED_OFFSET] = texturesEnabled && material.diffuseTexture !== undefined ? MATERIAL_TEXTURED : MATERIAL_UNTEXTURED;
    out[MATERIAL_SPECULAR_CUTOFF_OFFSET] = specularCutoffOf(material);
}

export function materialSamplerDescriptor(filtering: GpuTextureFiltering): GPUSamplerDescriptor {
    const mode: GPUFilterMode = filtering === LINEAR_TEXTURE_FILTERING ? "linear" : "nearest";
    return {
        label: `material ${mode}`,
        magFilter: mode,
        minFilter: mode,
        mipmapFilter: mode,
        addressModeU: "repeat",
        addressModeV: "repeat",
    };
}

function sameValues(a: Float32Array, b: Float32Array): boolean {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export class GpuMaterialCache {
    private readonly entries = new Map<Material, MaterialEntry>();
    private readonly samplers = new Map<GpuTextureFiltering, GPUSampler>();
    private readonly packed = new Float32Array(MATERIAL_UNIFORM_FLOATS);

    public constructor(
        private readonly device: GpuMaterialDevice,
        private readonly layout: GPUBindGroupLayout,
        private readonly textures: GpuTextureCache,
    ) {
    }

    public get size(): number {
        return this.entries.size;
    }

    public prepare(material: Material, texturesEnabled: boolean, filtering: GpuTextureFiltering, frame: number): GpuMaterial {
        packMaterial(material, texturesEnabled, this.packed);
        const sampler = this.samplerFor(filtering);
        let entry = this.entries.get(material);
        if (entry === undefined) {
            const uniformBuffer = this.device.createBuffer({
                label: `material ${material.name}`,
                size: MATERIAL_UNIFORM_FLOATS * FLOAT_BYTES,
                usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
            });
            entry = {
                uniformBuffer,
                ...this.bindingFor(uniformBuffer, material, sampler, frame),
                boundTexture: material.diffuseTexture,
                boundSpecularTexture: material.specularTexture,
                boundSampler: sampler,
                written: this.packed.slice(),
                lastUsedFrame: frame,
            };
            this.entries.set(material, entry);
            this.device.queue.writeBuffer(uniformBuffer, 0, asGpuBufferSource(entry.written));
            return entry;
        }
        if (entry.boundTexture !== material.diffuseTexture || entry.boundSpecularTexture !== material.specularTexture || entry.boundSampler !== sampler) {
            entry.boundTexture = material.diffuseTexture;
            entry.boundSpecularTexture = material.specularTexture;
            entry.boundSampler = sampler;
            Object.assign(entry, this.bindingFor(entry.uniformBuffer, material, sampler, frame));
        }
        entry.lastUsedFrame = frame;
        entry.diffuseUpload.lastUsedFrame = frame;
        entry.specularUpload.lastUsedFrame = frame;
        if (!sameValues(this.packed, entry.written)) {
            entry.written.set(this.packed);
            this.device.queue.writeBuffer(entry.uniformBuffer, 0, asGpuBufferSource(entry.written));
        }
        return entry;
    }

    public evictUnused(frame: number, maxUnusedFrames: number): void {
        for (const [material, entry] of this.entries) {
            if (frame - entry.lastUsedFrame <= maxUnusedFrames) continue;
            entry.uniformBuffer.destroy();
            this.entries.delete(material);
        }
    }

    public dispose(): void {
        for (const entry of this.entries.values()) entry.uniformBuffer.destroy();
        this.entries.clear();
    }

    private samplerFor(filtering: GpuTextureFiltering): GPUSampler {
        let sampler = this.samplers.get(filtering);
        if (sampler === undefined) {
            sampler = this.device.createSampler(materialSamplerDescriptor(filtering));
            this.samplers.set(filtering, sampler);
        }
        return sampler;
    }

    private bindingFor(uniformBuffer: GPUBuffer, material: Material, sampler: GPUSampler, frame: number): MaterialBinding {
        const diffuseUpload = this.textures.ensure(material.diffuseTexture, frame);
        const specularUpload = this.textures.ensure(material.specularTexture, frame);
        const bindGroup = this.device.createBindGroup({
            label: "material",
            layout: this.layout,
            entries: [
                {binding: MATERIAL_UNIFORMS_BINDING, resource: {buffer: uniformBuffer}},
                {binding: MATERIAL_SAMPLER_BINDING, resource: sampler},
                {binding: MATERIAL_TEXTURE_BINDING, resource: diffuseUpload.view},
                {binding: MATERIAL_SPECULAR_TEXTURE_BINDING, resource: specularUpload.view},
            ],
        });
        return {bindGroup, diffuseUpload, specularUpload};
    }
}
