import {LIGHT_KIND_DIRECTIONAL} from "../../engine/rendering/3d/lighting/sceneLights";
import type {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";

export const FLOAT_BYTES = 4;
export const VEC4_FLOATS = 4;

export const LIGHTS_AMBIENT_OFFSET = 0;
export const LIGHTS_COUNT_OFFSET = LIGHTS_AMBIENT_OFFSET + VEC4_FLOATS;
export const LIGHTS_LIT_OFFSET = LIGHTS_COUNT_OFFSET + 1;
export const LIGHTS_HEADER_FLOATS = LIGHTS_COUNT_OFFSET + VEC4_FLOATS;

export const LIGHT_VECTOR_OFFSET = 0;
export const LIGHT_COLOR_OFFSET = LIGHT_VECTOR_OFFSET + VEC4_FLOATS;
export const LIGHT_KIND_OFFSET = LIGHT_COLOR_OFFSET + VEC4_FLOATS;
export const LIGHT_RANGE_SQUARED_OFFSET = LIGHT_KIND_OFFSET + 1;
export const LIGHT_STRIDE_FLOATS = LIGHT_KIND_OFFSET + VEC4_FLOATS;

export const MIN_PACKED_LIGHTS = 1;
const INITIAL_LIGHT_CAPACITY = 8;
const GROWTH_FACTOR = 2;
const POINT_W = 1;
export const LIGHTS_LIT = 1;
export const LIGHTS_UNLIT = 0;

function floatsFor(lightCapacity: number): number {
    return LIGHTS_HEADER_FLOATS + Math.max(MIN_PACKED_LIGHTS, lightCapacity) * LIGHT_STRIDE_FLOATS;
}

export class GpuLightPacking {
    private _data: Float32Array;
    private _words: Uint32Array;
    private _count = 0;

    public constructor(initialCapacity: number = INITIAL_LIGHT_CAPACITY) {
        this._data = new Float32Array(floatsFor(initialCapacity));
        this._words = new Uint32Array(this._data.buffer);
    }

    public get data(): Float32Array {
        return this._data;
    }

    public get words(): Uint32Array {
        return this._words;
    }

    public get capacity(): number {
        return (this._data.length - LIGHTS_HEADER_FLOATS) / LIGHT_STRIDE_FLOATS;
    }

    public get count(): number {
        return this._count;
    }

    public get usedFloats(): number {
        return floatsFor(this._count);
    }

    public begin(count: number): void {
        this._count = count;
        if (count <= this.capacity) {
            this._data.fill(0, 0, this.usedFloats);
            return;
        }
        let capacity = this.capacity;
        while (capacity < count) capacity *= GROWTH_FACTOR;
        this._data = new Float32Array(floatsFor(capacity));
        this._words = new Uint32Array(this._data.buffer);
    }
}

export function packSceneLights(sceneLights: SceneLights | undefined, view: Float32Array, out: GpuLightPacking): void {
    const lit = sceneLights !== undefined && sceneLights.hasAnyLight;
    const count = lit ? sceneLights.count : 0;
    out.begin(count);
    const data = out.data;
    out.words[LIGHTS_COUNT_OFFSET] = count;
    out.words[LIGHTS_LIT_OFFSET] = lit ? LIGHTS_LIT : LIGHTS_UNLIT;
    if (!lit) return;
    data[LIGHTS_AMBIENT_OFFSET] = sceneLights.ambient[0];
    data[LIGHTS_AMBIENT_OFFSET + 1] = sceneLights.ambient[1];
    data[LIGHTS_AMBIENT_OFFSET + 2] = sceneLights.ambient[2];

    for (let i = 0, j = 0, o = LIGHTS_HEADER_FLOATS; i < count; i++, j += 3, o += LIGHT_STRIDE_FLOATS) {
        const kind = sceneLights.kind[i];
        const vector = o + LIGHT_VECTOR_OFFSET, color = o + LIGHT_COLOR_OFFSET;
        if (kind === LIGHT_KIND_DIRECTIONAL) {
            const dx = sceneLights.direction[j], dy = sceneLights.direction[j + 1], dz = sceneLights.direction[j + 2];
            data[vector] = -(view[0] * dx + view[4] * dy + view[8] * dz);
            data[vector + 1] = -(view[1] * dx + view[5] * dy + view[9] * dz);
            data[vector + 2] = -(view[2] * dx + view[6] * dy + view[10] * dz);
        } else {
            const px = sceneLights.position[j], py = sceneLights.position[j + 1], pz = sceneLights.position[j + 2];
            data[vector] = view[0] * px + view[4] * py + view[8] * pz + view[MAT4_TRANSLATION_X];
            data[vector + 1] = view[1] * px + view[5] * py + view[9] * pz + view[MAT4_TRANSLATION_Y];
            data[vector + 2] = view[2] * px + view[6] * py + view[10] * pz + view[MAT4_TRANSLATION_Z];
            data[vector + 3] = POINT_W;
            const range = sceneLights.range[i];
            data[o + LIGHT_RANGE_SQUARED_OFFSET] = range * range;
        }
        data[color] = sceneLights.color[j];
        data[color + 1] = sceneLights.color[j + 1];
        data[color + 2] = sceneLights.color[j + 2];
        data[o + LIGHT_KIND_OFFSET] = kind;
    }
}
