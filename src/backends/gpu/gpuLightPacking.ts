import {
    coneScaleOf,
    LIGHT_KIND_DIRECTIONAL,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
    RGB_CHANNELS,
    VEC3_FLOATS,
} from "../../engine/rendering/3d/lighting/sceneLights";
import type {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {MAT4_ELEMENT, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";

export const FLOAT_BYTES = 4;
export const VEC4_FLOATS = 4;
export const VEC4_W = 3;
export const MAT3_COLUMNS = 3;

export const LIGHTS_AMBIENT_OFFSET = 0;
export const LIGHTS_COUNT_OFFSET = LIGHTS_AMBIENT_OFFSET + VEC4_FLOATS;
export const LIGHTS_LIT_OFFSET = LIGHTS_COUNT_OFFSET + 1;
export const LIGHTS_HEMISPHERE_GRADIENT_OFFSET = LIGHTS_COUNT_OFFSET + VEC4_FLOATS;
export const LIGHTS_HEADER_FLOATS = LIGHTS_HEMISPHERE_GRADIENT_OFFSET + MAT3_COLUMNS * VEC4_FLOATS;

export const LIGHT_VECTOR_OFFSET = 0;
export const LIGHT_COLOR_OFFSET = LIGHT_VECTOR_OFFSET + VEC4_FLOATS;
export const LIGHT_KIND_OFFSET = LIGHT_COLOR_OFFSET + VEC4_FLOATS;
export const LIGHT_RANGE_SQUARED_OFFSET = LIGHT_KIND_OFFSET + 1;
export const LIGHT_SHADOW_MAP_OFFSET = LIGHT_RANGE_SQUARED_OFFSET + 1;
export const LIGHT_DIRECTION_OFFSET = LIGHT_KIND_OFFSET + VEC4_FLOATS;
export const LIGHT_AXIS_X_OFFSET = LIGHT_DIRECTION_OFFSET + VEC4_FLOATS;
export const LIGHT_EXTENT_X_OFFSET = LIGHT_AXIS_X_OFFSET + VEC4_W;
export const LIGHT_AXIS_Y_OFFSET = LIGHT_AXIS_X_OFFSET + VEC4_FLOATS;
export const LIGHT_EXTENT_Y_OFFSET = LIGHT_AXIS_Y_OFFSET + VEC4_W;
export const LIGHT_SHAPE_OFFSET = LIGHT_AXIS_Y_OFFSET + VEC4_FLOATS;
export const LIGHT_RADIUS_OFFSET = LIGHT_SHAPE_OFFSET;
export const LIGHT_CONE_COS_OUTER_OFFSET = LIGHT_SHAPE_OFFSET + 1;
export const LIGHT_CONE_SCALE_OFFSET = LIGHT_SHAPE_OFFSET + 2;
export const LIGHT_STRIDE_FLOATS = LIGHT_SHAPE_OFFSET + VEC4_FLOATS;

export const MIN_PACKED_LIGHTS = 1;
const INITIAL_LIGHT_CAPACITY = 8;
const GROWTH_FACTOR = 2;
const POINT_W = 1;
export const LIGHTS_LIT = 1;
export const LIGHTS_UNLIT = 0;
export const NO_SHADOW_MAP_SLOT = -1;

function floatsFor(lightCapacity: number): number {
    return LIGHTS_HEADER_FLOATS + Math.max(MIN_PACKED_LIGHTS, lightCapacity) * LIGHT_STRIDE_FLOATS;
}

function writeViewRotated(data: Float32Array, offset: number, view: Float32Array, source: Float32Array, sourceOffset: number): void {
    const x = source[sourceOffset], y = source[sourceOffset + 1], z = source[sourceOffset + 2];
    data[offset] = view[0] * x + view[4] * y + view[8] * z;
    data[offset + 1] = view[1] * x + view[5] * y + view[9] * z;
    data[offset + 2] = view[2] * x + view[6] * y + view[10] * z;
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
    if (sceneLights.hasHemisphere) packHemisphereGradient(sceneLights.hemisphereGradient, view, data);

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
        data[o + LIGHT_SHADOW_MAP_OFFSET] = NO_SHADOW_MAP_SLOT;
        packLightShape(sceneLights, i, view, data, o);
    }
}

function packHemisphereGradient(gradient: Float32Array, view: Float32Array, data: Float32Array): void {
    for (let channel = 0, g = 0; channel < RGB_CHANNELS; channel++, g += VEC3_FLOATS) {
        const gx = gradient[g], gy = gradient[g + 1], gz = gradient[g + 2];
        for (let axis = 0; axis < MAT3_COLUMNS; axis++) {
            data[LIGHTS_HEMISPHERE_GRADIENT_OFFSET + axis * VEC4_FLOATS + channel] = view[MAT4_ELEMENT.m00 + axis] * gx + view[MAT4_ELEMENT.m01 + axis] * gy + view[MAT4_ELEMENT.m02 + axis] * gz;
        }
    }
}

function packLightShape(sceneLights: SceneLights, index: number, view: Float32Array, data: Float32Array, o: number): void {
    const kind = sceneLights.kind[index];
    const j = index * VEC3_FLOATS;
    if (kind === LIGHT_KIND_SPOT || kind === LIGHT_KIND_RECT) writeViewRotated(data, o + LIGHT_DIRECTION_OFFSET, view, sceneLights.direction, j);
    if (kind === LIGHT_KIND_SPOT) {
        data[o + LIGHT_CONE_COS_OUTER_OFFSET] = sceneLights.coneCosOuter[index];
        data[o + LIGHT_CONE_SCALE_OFFSET] = coneScaleOf(sceneLights.coneCosInner[index], sceneLights.coneCosOuter[index]);
    }
    if (kind === LIGHT_KIND_SPHERE || kind === LIGHT_KIND_TUBE) data[o + LIGHT_RADIUS_OFFSET] = sceneLights.radius[index];
    if (kind === LIGHT_KIND_TUBE || kind === LIGHT_KIND_RECT) {
        writeViewRotated(data, o + LIGHT_AXIS_X_OFFSET, view, sceneLights.axisX, j);
        data[o + LIGHT_EXTENT_X_OFFSET] = sceneLights.extentX[index];
    }
    if (kind === LIGHT_KIND_RECT) {
        writeViewRotated(data, o + LIGHT_AXIS_Y_OFFSET, view, sceneLights.axisY, j);
        data[o + LIGHT_EXTENT_Y_OFFSET] = sceneLights.extentY[index];
    }
}

export function assignLightShadowMap(out: GpuLightPacking, lightIndex: number, slot: number): void {
    out.data[LIGHTS_HEADER_FLOATS + lightIndex * LIGHT_STRIDE_FLOATS + LIGHT_SHADOW_MAP_OFFSET] = slot;
}
