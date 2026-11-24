import {Component} from "../../engine/core";
import {MAX_RENDER_TARGET_PX} from "./gpuMeshPassSettings";

export const NO_SHADOW_MAP = 0;
export const MIN_SHADOW_MAP_SIZE = 16;
export const MAX_SHADOW_MAP_SIZE = MAX_RENDER_TARGET_PX;
const DEFAULT_SHADOW_MAP_SIZE = 2048;
const DEFAULT_MAX_DISTANCE = 50;
const DEFAULT_FADE_FRACTION = 0.1;
const DEFAULT_DEPTH_BIAS_TEXELS = 0.5;
const DEFAULT_NORMAL_BIAS_TEXELS = 1.5;
const DEFAULT_SLOPE_BIAS = 1;
const DEFAULT_FILTER_RADIUS_TEXELS = 1;
const DEFAULT_STRENGTH = 1;
const NO_SLOPE_BIAS = 0;

export class GpuShadowSettings extends Component {
    public mapSize: number = DEFAULT_SHADOW_MAP_SIZE;
    public maxDistance: number = DEFAULT_MAX_DISTANCE;
    public fadeFraction: number = DEFAULT_FADE_FRACTION;
    public depthBiasTexels: number = DEFAULT_DEPTH_BIAS_TEXELS;
    public normalBiasTexels: number = DEFAULT_NORMAL_BIAS_TEXELS;
    public slopeBias: number = DEFAULT_SLOPE_BIAS;
    public filterRadiusTexels: number = DEFAULT_FILTER_RADIUS_TEXELS;
    public strength: number = DEFAULT_STRENGTH;
}

export function shadowMapSizeOf(settings: GpuShadowSettings): number {
    const requested = settings.mapSize;
    if (!Number.isFinite(requested) || requested <= 0) return NO_SHADOW_MAP;
    return Math.min(MAX_SHADOW_MAP_SIZE, Math.max(MIN_SHADOW_MAP_SIZE, Math.round(requested)));
}

export function shadowSlopeBiasOf(settings: GpuShadowSettings): number {
    return Number.isFinite(settings.slopeBias) ? settings.slopeBias : NO_SLOPE_BIAS;
}

export function nonNegativeOrZero(value: number): number {
    return value > 0 ? value : 0;
}

export function unitIntervalOf(value: number): number {
    return value > 1 ? 1 : nonNegativeOrZero(value);
}
