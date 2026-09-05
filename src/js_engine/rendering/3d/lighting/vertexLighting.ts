import {asFloat32Array, ReadonlyVec16} from "../../../math/types/vec";
import {DeepReadonly} from "../../../util/tokenUtils";
import {Texture} from "../texture";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import {LIGHT_KIND_DIRECTIONAL, SceneLights} from "./sceneLights";

const NEGLIGIBLE_SPECULAR = 0.005;
const NO_SPECULAR_CUTOFF = 2;

export class VertexLighting {
    private lightCount: number = 0;
    private isLit: boolean = false;
    private readonly ambient: Float64Array = new Float64Array(3);
    private kind: Uint8Array = new Uint8Array(0);
    private vector: Float64Array = new Float64Array(0);
    private color: Float64Array = new Float64Array(0);
    private rangeSquared: Float64Array = new Float64Array(0);
    private vertexRgb: Float64Array = new Float64Array(0);
    private materialAlbedo: Float64Array = new Float64Array(3);
    private materialSpecular: Float64Array = new Float64Array(3);
    private materialEmissive: Float64Array = new Float64Array(3);
    private materialShininess: Float64Array = new Float64Array(1);
    private materialSpecularCutoff: Float64Array = new Float64Array(1);
    private readonly materialSpecularTexture: (DeepReadonly<Texture> | undefined)[] = [];

    public get lit(): boolean {
        return this.isLit;
    }

    public beginFrame(sceneLights: SceneLights, viewMatrix: ReadonlyVec16): void {
        const count = sceneLights.count;
        this.isLit = sceneLights.hasAnyLight;
        this.lightCount = count;
        this.ambient[0] = sceneLights.ambient[0];
        this.ambient[1] = sceneLights.ambient[1];
        this.ambient[2] = sceneLights.ambient[2];
        if (this.kind.length < count) {
            this.kind = new Uint8Array(count);
            this.vector = new Float64Array(count * 3);
            this.color = new Float64Array(count * 3);
            this.rangeSquared = new Float64Array(count);
        }

        const m = asFloat32Array(viewMatrix);
        for (let i = 0, j = 0; i < count; i++, j += 3) {
            const kind = sceneLights.kind[i];
            this.kind[i] = kind;
            this.color[j] = sceneLights.color[j];
            this.color[j + 1] = sceneLights.color[j + 1];
            this.color[j + 2] = sceneLights.color[j + 2];
            if (kind === LIGHT_KIND_DIRECTIONAL) {
                const dx = sceneLights.direction[j], dy = sceneLights.direction[j + 1], dz = sceneLights.direction[j + 2];
                this.vector[j] = -(m[0] * dx + m[4] * dy + m[8] * dz);
                this.vector[j + 1] = -(m[1] * dx + m[5] * dy + m[9] * dz);
                this.vector[j + 2] = -(m[2] * dx + m[6] * dy + m[10] * dz);
            } else {
                const px = sceneLights.position[j], py = sceneLights.position[j + 1], pz = sceneLights.position[j + 2];
                this.vector[j] = m[0] * px + m[4] * py + m[8] * pz + m[12];
                this.vector[j + 1] = m[1] * px + m[5] * py + m[9] * pz + m[13];
                this.vector[j + 2] = m[2] * px + m[6] * py + m[10] * pz + m[14];
                const range = sceneLights.range[i];
                this.rangeSquared[i] = range * range;
            }
        }
    }

    public shade(viewMesh: ViewSpaceMesh, tint: number): Float64Array {
        const vertCount = viewMesh.vertCount;
        const floatCount = vertCount * 3;
        if (this.vertexRgb.length < floatCount) this.vertexRgb = new Float64Array(floatCount);
        const out = this.vertexRgb;
        const positions = viewMesh.positions;
        const normals = viewMesh.normals;
        this.fillMaterialParameters(viewMesh, tint);
        const albedo = this.materialAlbedo, specular = this.materialSpecular, emissive = this.materialEmissive;
        const shininessByMaterial = this.materialShininess, cutoffByMaterial = this.materialSpecularCutoff;
        const specularTextures = this.materialSpecularTexture;
        const vertexMaterial = viewMesh.mesh?.vertexMaterial;
        const uvs = viewMesh.mesh?.uvs.raw;
        const ambientR = this.ambient[0], ambientG = this.ambient[1], ambientB = this.ambient[2];
        const lightCount = this.lightCount;
        const kind = this.kind, vector = this.vector, color = this.color, rangeSquared = this.rangeSquared;

        for (let j = 0, vertex = 0; j < floatCount; j += 3, vertex++) {
            const material = vertexMaterial === undefined ? 0 : vertexMaterial[vertex];
            const materialOffset = material * 3;
            const specularCutoff = cutoffByMaterial[material];
            const hasSpecular = specularCutoff <= 1;
            const shininess = shininessByMaterial[material];
            const nx = normals[j], ny = normals[j + 1], nz = normals[j + 2];
            let viewX = 0, viewY = 0, viewZ = 0;
            let glossR = 1, glossG = 1, glossB = 1;
            if (hasSpecular) {
                const px = positions[j], py = positions[j + 1], pz = positions[j + 2];
                const invDistance = 1 / (Math.sqrt(px * px + py * py + pz * pz) || 1);
                viewX = -px * invDistance;
                viewY = -py * invDistance;
                viewZ = -pz * invDistance;
                const glossTexture = specularTextures[material];
                if (glossTexture !== undefined && uvs !== undefined) {
                    const texel = sampleBaseLevel(glossTexture, uvs[j], uvs[j + 1]);
                    glossR = ((texel >> 16) & 255) / 255;
                    glossG = ((texel >> 8) & 255) / 255;
                    glossB = (texel & 255) / 255;
                }
            }
            let r = ambientR, g = ambientG, b = ambientB;
            let specularR = 0, specularG = 0, specularB = 0;

            for (let i = 0, l = 0; i < lightCount; i++, l += 3) {
                let diffuse: number;
                let lightX = 0, lightY = 0, lightZ = 0;
                let attenuation = 1;
                if (kind[i] === LIGHT_KIND_DIRECTIONAL) {
                    lightX = vector[l];
                    lightY = vector[l + 1];
                    lightZ = vector[l + 2];
                    diffuse = nx * lightX + ny * lightY + nz * lightZ;
                } else {
                    const dx = vector[l] - positions[j], dy = vector[l + 1] - positions[j + 1], dz = vector[l + 2] - positions[j + 2];
                    const distanceSquared = dx * dx + dy * dy + dz * dz;
                    const rangeSq = rangeSquared[i];
                    if (distanceSquared >= rangeSq || distanceSquared === 0) continue;
                    const falloff = 1 - distanceSquared / rangeSq;
                    const distance = Math.sqrt(distanceSquared);
                    diffuse = (nx * dx + ny * dy + nz * dz) / distance * falloff * falloff;
                    if (hasSpecular) {
                        lightX = dx / distance;
                        lightY = dy / distance;
                        lightZ = dz / distance;
                        attenuation = falloff * falloff;
                    }
                }
                if (diffuse <= 0) continue;
                r += color[l] * diffuse;
                g += color[l + 1] * diffuse;
                b += color[l + 2] * diffuse;

                if (!hasSpecular) continue;
                const halfX = lightX + viewX, halfY = lightY + viewY, halfZ = lightZ + viewZ;
                const halfLength = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);
                if (halfLength === 0) continue;
                const normalDotHalf = (nx * halfX + ny * halfY + nz * halfZ) / halfLength;
                if (normalDotHalf < specularCutoff) continue;
                const highlight = Math.pow(normalDotHalf, shininess) * attenuation;
                specularR += color[l] * highlight;
                specularG += color[l + 1] * highlight;
                specularB += color[l + 2] * highlight;
            }

            out[j] = r * albedo[materialOffset] + specularR * glossR * specular[materialOffset] + emissive[materialOffset];
            out[j + 1] = g * albedo[materialOffset + 1] + specularG * glossG * specular[materialOffset + 1] + emissive[materialOffset + 1];
            out[j + 2] = b * albedo[materialOffset + 2] + specularB * glossB * specular[materialOffset + 2] + emissive[materialOffset + 2];
        }
        return out;
    }

    private fillMaterialParameters(viewMesh: ViewSpaceMesh, tint: number): void {
        const materials = viewMesh.mesh?.materials;
        const materialCount = materials === undefined ? 1 : materials.length;
        if (this.materialAlbedo.length < materialCount * 3) {
            this.materialAlbedo = new Float64Array(materialCount * 3);
            this.materialSpecular = new Float64Array(materialCount * 3);
            this.materialEmissive = new Float64Array(materialCount * 3);
            this.materialShininess = new Float64Array(materialCount);
            this.materialSpecularCutoff = new Float64Array(materialCount);
        }
        this.materialSpecularTexture.length = materialCount;
        const tintR = ((tint >> 16) & 255) / 255, tintG = ((tint >> 8) & 255) / 255, tintB = (tint & 255) / 255;
        for (let i = 0, j = 0; i < materialCount; i++, j += 3) {
            const material = materials?.[i];
            const specularColor = material?.specularColor ?? 0;
            const shininess = material?.shininess ?? 0;
            writeTintedRgb(this.materialAlbedo, j, material?.diffuseColor ?? 0xFFFFFF, tintR, tintG, tintB);
            writeTintedRgb(this.materialSpecular, j, specularColor, tintR, tintG, tintB);
            writeTintedRgb(this.materialEmissive, j, material?.emissiveColor ?? 0, tintR, tintG, tintB);
            this.materialShininess[i] = shininess;
            this.materialSpecularCutoff[i] = specularColor === 0 ? NO_SPECULAR_CUTOFF : Math.pow(NEGLIGIBLE_SPECULAR, 1 / shininess);
            this.materialSpecularTexture[i] = material?.specularTexture;
        }
    }
}

function sampleBaseLevel(texture: DeepReadonly<Texture>, u: number, v: number): number {
    const {width, height, texels} = texture.levels[0];
    const x = Math.floor((u - Math.floor(u)) * width);
    const y = Math.floor((v - Math.floor(v)) * height);
    return texels[y * width + x];
}

function writeTintedRgb(out: Float64Array, offset: number, packed: number, tintR: number, tintG: number, tintB: number): void {
    out[offset] = (((packed >> 16) & 255) / 255) * tintR;
    out[offset + 1] = (((packed >> 8) & 255) / 255) * tintG;
    out[offset + 2] = ((packed & 255) / 255) * tintB;
}
