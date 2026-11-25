import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {VEC4_FLOATS} from "./gpuLightPacking";
import type {GpuShadowFit} from "./gpuShadowFit";
import type {GpuShadowCube, GpuShadowFrustum} from "./gpuShadowFrustum";
import {nonNegativeOrZero, unitIntervalOf} from "./gpuShadowSettings";
import type {GpuShadowSettings} from "./gpuShadowSettings";

export const SHADOWS_PRIMARY_LIGHT_OFFSET = 0;
export const SHADOWS_MAP_COUNT_OFFSET = SHADOWS_PRIMARY_LIGHT_OFFSET + 1;
export const SHADOWS_HEADER_FLOATS = VEC4_FLOATS;

export const SHADOW_MAP_VIEW_TO_LIGHT_OFFSET = 0;
export const SHADOW_MAP_PROJECTION_OFFSET = SHADOW_MAP_VIEW_TO_LIGHT_OFFSET + MAT4_FLOATS;
export const SHADOW_MAP_LAYER_OFFSET = SHADOW_MAP_PROJECTION_OFFSET + 1;
export const SHADOW_MAP_DEPTH_BIAS_OFFSET = SHADOW_MAP_LAYER_OFFSET + 1;
export const SHADOW_MAP_NORMAL_OFFSET_OFFSET = SHADOW_MAP_DEPTH_BIAS_OFFSET + 1;
export const SHADOW_MAP_FILTER_STEP_OFFSET = SHADOW_MAP_NORMAL_OFFSET_OFFSET + 1;
export const SHADOW_MAP_STRENGTH_OFFSET = SHADOW_MAP_FILTER_STEP_OFFSET + 1;
export const SHADOW_MAP_FADE_START_OFFSET = SHADOW_MAP_STRENGTH_OFFSET + 1;
export const SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET = SHADOW_MAP_FADE_START_OFFSET + 1;
export const SHADOW_MAP_DEPTH_SCALE_OFFSET = SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET + 1;
export const SHADOW_MAP_DEPTH_OFFSET_OFFSET = SHADOW_MAP_DEPTH_SCALE_OFFSET + 1;
const SHADOW_MAP_RESERVED_FLOATS = 2;
export const SHADOW_MAP_STRIDE_FLOATS = SHADOW_MAP_DEPTH_OFFSET_OFFSET + 1 + SHADOW_MAP_RESERVED_FLOATS;

export const SHADOW_PROJECTION_ORTHOGRAPHIC = 0;
export const SHADOW_PROJECTION_PERSPECTIVE = 1;
export const SHADOW_PROJECTION_CUBE = 2;

export const NO_SHADOWED_LIGHT = 0xFFFFFFFF;
export const MIN_SHADOW_FADE_LENGTH = 1e-3;
export const SHADOW_MAP_FARTHEST_DEPTH = 1;
export const FULLY_LIT = 1;
export const MAX_DISTANCE_BIAS_FRACTION = 0.5;
const NO_FADE_START = 0;
const NO_FADE = 0;
const NO_DEPTH_SCALE = 0;
const NO_DEPTH_OFFSET = 0;
const MIN_PACKED_SHADOW_MAPS = 1;
const GROWTH_FACTOR = 2;

function floatsFor(mapCapacity: number): number {
    return SHADOWS_HEADER_FLOATS + Math.max(MIN_PACKED_SHADOW_MAPS, mapCapacity) * SHADOW_MAP_STRIDE_FLOATS;
}

function mapOffset(map: number): number {
    return SHADOWS_HEADER_FLOATS + map * SHADOW_MAP_STRIDE_FLOATS;
}

export class GpuShadowPacking {
    private _data: Float32Array;
    private _words: Uint32Array;
    private _count = 0;

    public constructor(initialCapacity: number = MIN_PACKED_SHADOW_MAPS) {
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
        return (this._data.length - SHADOWS_HEADER_FLOATS) / SHADOW_MAP_STRIDE_FLOATS;
    }

    public get count(): number {
        return this._count;
    }

    public get usedFloats(): number {
        return floatsFor(this._count);
    }

    public begin(mapCount: number): void {
        if (mapCount > this.capacity) {
            let capacity = this.capacity;
            while (capacity < mapCount) capacity *= GROWTH_FACTOR;
            this._data = new Float32Array(floatsFor(capacity));
            this._words = new Uint32Array(this._data.buffer);
        }
        this._count = mapCount;
        this._data.fill(0, 0, this.usedFloats);
        this._words[SHADOWS_PRIMARY_LIGHT_OFFSET] = NO_SHADOWED_LIGHT;
        this._words[SHADOWS_MAP_COUNT_OFFSET] = mapCount;
    }

    public setPrimaryLight(lightIndex: number): void {
        this._words[SHADOWS_PRIMARY_LIGHT_OFFSET] = lightIndex;
    }
}

export function packShadowsOff(out: GpuShadowPacking): void {
    out.begin(0);
}

function packCommon(out: GpuShadowPacking, map: number, viewToLight: Float32Array, projection: number, layer: number, settings: GpuShadowSettings, filterStep: number): number {
    const o = mapOffset(map);
    out.data.set(viewToLight, o + SHADOW_MAP_VIEW_TO_LIGHT_OFFSET);
    out.words[o + SHADOW_MAP_PROJECTION_OFFSET] = projection;
    out.words[o + SHADOW_MAP_LAYER_OFFSET] = layer;
    out.data[o + SHADOW_MAP_FILTER_STEP_OFFSET] = filterStep;
    out.data[o + SHADOW_MAP_STRENGTH_OFFSET] = unitIntervalOf(settings.strength);
    return o;
}

function packDistanceScaled(out: GpuShadowPacking, o: number, settings: GpuShadowSettings, texelSpread: number, viewUnitsPerWorldUnit: number,
    depthScale: number, depthOffset: number): void {
    const data = out.data;
    data[o + SHADOW_MAP_DEPTH_BIAS_OFFSET] = Math.min(nonNegativeOrZero(settings.depthBiasTexels) * texelSpread, MAX_DISTANCE_BIAS_FRACTION);
    data[o + SHADOW_MAP_NORMAL_OFFSET_OFFSET] = nonNegativeOrZero(settings.normalBiasTexels) * texelSpread * viewUnitsPerWorldUnit;
    data[o + SHADOW_MAP_FADE_START_OFFSET] = NO_FADE_START;
    data[o + SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET] = NO_FADE;
    data[o + SHADOW_MAP_DEPTH_SCALE_OFFSET] = depthScale;
    data[o + SHADOW_MAP_DEPTH_OFFSET_OFFSET] = depthOffset;
}

export function packDirectionalShadowMap(out: GpuShadowPacking, map: number, fit: GpuShadowFit, settings: GpuShadowSettings, layer: number): void {
    const o = packCommon(out, map, fit.viewToLightClip, SHADOW_PROJECTION_ORTHOGRAPHIC, layer, settings, nonNegativeOrZero(settings.filterRadiusTexels) / fit.mapSize);
    const data = out.data;
    data[o + SHADOW_MAP_DEPTH_BIAS_OFFSET] = nonNegativeOrZero(settings.depthBiasTexels) * fit.texelWorldSize / fit.depthRange;
    data[o + SHADOW_MAP_NORMAL_OFFSET_OFFSET] = nonNegativeOrZero(settings.normalBiasTexels) * fit.texelWorldSize * fit.viewUnitsPerWorldUnit;
    const fadeLength = Math.max(MIN_SHADOW_FADE_LENGTH, fit.sliceFarViewDepth * unitIntervalOf(settings.fadeFraction));
    data[o + SHADOW_MAP_FADE_START_OFFSET] = fit.sliceFarViewDepth - fadeLength;
    data[o + SHADOW_MAP_FADE_INVERSE_LENGTH_OFFSET] = 1 / fadeLength;
    data[o + SHADOW_MAP_DEPTH_SCALE_OFFSET] = NO_DEPTH_SCALE;
    data[o + SHADOW_MAP_DEPTH_OFFSET_OFFSET] = NO_DEPTH_OFFSET;
}

export function packPerspectiveShadowMap(out: GpuShadowPacking, map: number, frustum: GpuShadowFrustum, settings: GpuShadowSettings, layer: number,
    viewUnitsPerWorldUnit: number): void {
    const o = packCommon(out, map, frustum.viewToLightClip, SHADOW_PROJECTION_PERSPECTIVE, layer, settings, nonNegativeOrZero(settings.filterRadiusTexels) / frustum.mapSize);
    packDistanceScaled(out, o, settings, frustum.texelSpread, viewUnitsPerWorldUnit, frustum.depthScale, frustum.depthOffset);
}

export function packCubeShadowMap(out: GpuShadowPacking, map: number, cube: GpuShadowCube, settings: GpuShadowSettings, layer: number,
    viewUnitsPerWorldUnit: number): void {
    const texelSpread = cube.texelSpread;
    const o = packCommon(out, map, cube.viewToLightOffset, SHADOW_PROJECTION_CUBE, layer, settings, nonNegativeOrZero(settings.filterRadiusTexels) * texelSpread);
    packDistanceScaled(out, o, settings, texelSpread, viewUnitsPerWorldUnit, cube.depthScale, cube.depthOffset);
}
