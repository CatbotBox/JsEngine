import {asFloat32Array, ReadonlyVec16} from "../../../math/types/vec";
import {ViewSpaceMesh} from "../viewSpaceMesh";
import {LIGHT_KIND_DIRECTIONAL, SceneLights} from "./sceneLights";

export class VertexLighting {
    private lightCount: number = 0;
    private isLit: boolean = false;
    private readonly ambient: Float64Array = new Float64Array(3);
    private kind: Uint8Array = new Uint8Array(0);
    private vector: Float64Array = new Float64Array(0);
    private color: Float64Array = new Float64Array(0);
    private rangeSquared: Float64Array = new Float64Array(0);
    private vertexRgb: Float64Array = new Float64Array(0);

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

    public shade(viewMesh: ViewSpaceMesh, albedo: number): Float64Array {
        const vertCount = viewMesh.vertCount;
        const floatCount = vertCount * 3;
        if (this.vertexRgb.length < floatCount) this.vertexRgb = new Float64Array(floatCount);
        const out = this.vertexRgb;
        const positions = viewMesh.positions;
        const normals = viewMesh.normals;
        const albedoR = ((albedo >> 16) & 255) / 255, albedoG = ((albedo >> 8) & 255) / 255, albedoB = (albedo & 255) / 255;
        const ambientR = this.ambient[0], ambientG = this.ambient[1], ambientB = this.ambient[2];
        const lightCount = this.lightCount;
        const kind = this.kind, vector = this.vector, color = this.color, rangeSquared = this.rangeSquared;

        for (let j = 0; j < floatCount; j += 3) {
            const nx = normals[j], ny = normals[j + 1], nz = normals[j + 2];
            let r = ambientR, g = ambientG, b = ambientB;

            for (let i = 0, l = 0; i < lightCount; i++, l += 3) {
                let diffuse: number;
                if (kind[i] === LIGHT_KIND_DIRECTIONAL) {
                    diffuse = nx * vector[l] + ny * vector[l + 1] + nz * vector[l + 2];
                } else {
                    const dx = vector[l] - positions[j], dy = vector[l + 1] - positions[j + 1], dz = vector[l + 2] - positions[j + 2];
                    const distanceSquared = dx * dx + dy * dy + dz * dz;
                    const rangeSq = rangeSquared[i];
                    if (distanceSquared >= rangeSq || distanceSquared === 0) continue;
                    const falloff = 1 - distanceSquared / rangeSq;
                    diffuse = (nx * dx + ny * dy + nz * dz) / Math.sqrt(distanceSquared) * falloff * falloff;
                }
                if (diffuse <= 0) continue;
                r += color[l] * diffuse;
                g += color[l + 1] * diffuse;
                b += color[l + 2] * diffuse;
            }

            out[j] = r * albedoR;
            out[j + 1] = g * albedoG;
            out[j + 2] = b * albedoB;
        }
        return out;
    }
}
