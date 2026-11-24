import {LIGHT_KIND_DIRECTIONAL} from "../../engine/rendering/3d/lighting/sceneLights";
import type {SceneLights} from "../../engine/rendering/3d/lighting/sceneLights";
import {MAT4_FLOATS} from "../../engine/math/mat4Layout";
import type {GpuShadowFit} from "./gpuShadowFit";
import {nonNegativeOrZero, unitIntervalOf} from "./gpuShadowSettings";
import type {GpuShadowSettings} from "./gpuShadowSettings";

export const SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET = 0;
export const SHADOW_LIGHT_INDEX_OFFSET = SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET + MAT4_FLOATS;
export const SHADOW_ENABLED_OFFSET = SHADOW_LIGHT_INDEX_OFFSET + 1;
export const SHADOW_DEPTH_BIAS_OFFSET = SHADOW_ENABLED_OFFSET + 1;
export const SHADOW_NORMAL_OFFSET_OFFSET = SHADOW_DEPTH_BIAS_OFFSET + 1;
export const SHADOW_FILTER_STEP_OFFSET = SHADOW_NORMAL_OFFSET_OFFSET + 1;
export const SHADOW_STRENGTH_OFFSET = SHADOW_FILTER_STEP_OFFSET + 1;
export const SHADOW_FADE_START_OFFSET = SHADOW_STRENGTH_OFFSET + 1;
export const SHADOW_FADE_INVERSE_LENGTH_OFFSET = SHADOW_FADE_START_OFFSET + 1;
export const SHADOW_UNIFORM_FLOATS = SHADOW_FADE_INVERSE_LENGTH_OFFSET + 1;

export const SHADOWS_ON = 1;
export const SHADOWS_OFF = 0;
export const NO_SHADOWED_LIGHT = 0xFFFFFFFF;
export const MIN_SHADOW_FADE_LENGTH = 1e-3;
export const SHADOW_MAP_FARTHEST_DEPTH = 1;
export const FULLY_LIT = 1;

export class GpuShadowUniforms {
    public readonly data = new Float32Array(SHADOW_UNIFORM_FLOATS);
    public readonly words = new Uint32Array(this.data.buffer);
}

export function firstDirectionalLightOf(lights: SceneLights | undefined): number {
    if (lights === undefined || !lights.hasAnyLight) return NO_SHADOWED_LIGHT;
    for (let i = 0; i < lights.count; i++) if (lights.kind[i] === LIGHT_KIND_DIRECTIONAL) return i;
    return NO_SHADOWED_LIGHT;
}

export function packShadowsOff(out: GpuShadowUniforms): void {
    out.data.fill(0);
    out.words[SHADOW_LIGHT_INDEX_OFFSET] = NO_SHADOWED_LIGHT;
    out.words[SHADOW_ENABLED_OFFSET] = SHADOWS_OFF;
}

export function packShadowUniforms(out: GpuShadowUniforms, fit: GpuShadowFit, settings: GpuShadowSettings, lightIndex: number): void {
    const data = out.data;
    data.set(fit.viewToLightClip, SHADOW_VIEW_TO_LIGHT_CLIP_OFFSET);
    out.words[SHADOW_LIGHT_INDEX_OFFSET] = lightIndex;
    out.words[SHADOW_ENABLED_OFFSET] = SHADOWS_ON;
    data[SHADOW_DEPTH_BIAS_OFFSET] = nonNegativeOrZero(settings.depthBiasTexels) * fit.texelWorldSize / fit.depthRange;
    data[SHADOW_NORMAL_OFFSET_OFFSET] = nonNegativeOrZero(settings.normalBiasTexels) * fit.texelWorldSize * fit.viewUnitsPerWorldUnit;
    data[SHADOW_FILTER_STEP_OFFSET] = nonNegativeOrZero(settings.filterRadiusTexels) / fit.mapSize;
    data[SHADOW_STRENGTH_OFFSET] = unitIntervalOf(settings.strength);
    const fadeLength = Math.max(MIN_SHADOW_FADE_LENGTH, fit.sliceFarViewDepth * unitIntervalOf(settings.fadeFraction));
    data[SHADOW_FADE_START_OFFSET] = fit.sliceFarViewDepth - fadeLength;
    data[SHADOW_FADE_INVERSE_LENGTH_OFFSET] = 1 / fadeLength;
}
