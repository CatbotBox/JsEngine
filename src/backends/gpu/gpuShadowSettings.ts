import {Component} from "../../engine/core";
import {MAX_RENDER_TARGET_PX} from "./gpuMeshPassSettings";

export const NO_SHADOW_MAP = 0;
export const MIN_SHADOW_MAP_SIZE = 16;
export const MAX_SHADOW_MAP_SIZE = MAX_RENDER_TARGET_PX;
export const CUBE_FACES = 6;
export const MAX_SHADOW_MAP_LAYERS = 256;
export const MAX_SHADOWED_LIGHTS = MAX_SHADOW_MAP_LAYERS;
export const MAX_POINT_SHADOWS = 42;
const DEFAULT_SHADOW_MAP_SIZE = 2048;
const DEFAULT_SPOT_MAP_SIZE = 1024;
const DEFAULT_POINT_MAP_SIZE = 512;
const DEFAULT_MAX_SHADOWED_LIGHTS = 6;
const DEFAULT_MAX_POINT_SHADOWS = 2;
const DEFAULT_MAX_DISTANCE = 50;
const DEFAULT_FADE_FRACTION = 0.1;
const DEFAULT_DEPTH_BIAS_TEXELS = 0.5;
const DEFAULT_NORMAL_BIAS_TEXELS = 1.5;
const DEFAULT_SLOPE_BIAS = 1;
const DEFAULT_FILTER_RADIUS_TEXELS = 1;
const DEFAULT_STRENGTH = 1;
const NO_SLOPE_BIAS = 0;
const NO_LIGHTS = 0;

export class GpuShadowSettings extends Component {
    public mapSize: number = DEFAULT_SHADOW_MAP_SIZE;
    public maxDistance: number = DEFAULT_MAX_DISTANCE;
    public fadeFraction: number = DEFAULT_FADE_FRACTION;
    public depthBiasTexels: number = DEFAULT_DEPTH_BIAS_TEXELS;
    public normalBiasTexels: number = DEFAULT_NORMAL_BIAS_TEXELS;
    public slopeBias: number = DEFAULT_SLOPE_BIAS;
    public filterRadiusTexels: number = DEFAULT_FILTER_RADIUS_TEXELS;
    public strength: number = DEFAULT_STRENGTH;
    public maxShadowedLights: number = DEFAULT_MAX_SHADOWED_LIGHTS;
    public maxPointShadows: number = DEFAULT_MAX_POINT_SHADOWS;
    public spotMapSize: number = DEFAULT_SPOT_MAP_SIZE;
    public pointMapSize: number = DEFAULT_POINT_MAP_SIZE;
}

function mapSizeOf(requested: number): number {
    if (!Number.isFinite(requested) || requested <= 0) return NO_SHADOW_MAP;
    return Math.min(MAX_SHADOW_MAP_SIZE, Math.max(MIN_SHADOW_MAP_SIZE, Math.round(requested)));
}

function lightCountOf(requested: number, limit: number): number {
    if (!(requested > 0)) return NO_LIGHTS;
    return Math.min(limit, Math.floor(requested));
}

export function shadowMapSizeOf(settings: GpuShadowSettings): number {
    return mapSizeOf(settings.mapSize);
}

export function spotShadowMapSizeOf(settings: GpuShadowSettings): number {
    return mapSizeOf(settings.spotMapSize);
}

export function pointShadowMapSizeOf(settings: GpuShadowSettings): number {
    return mapSizeOf(settings.pointMapSize);
}

export function shadowedLightBudgetOf(settings: GpuShadowSettings): number {
    return lightCountOf(settings.maxShadowedLights, MAX_SHADOWED_LIGHTS);
}

export function pointShadowBudgetOf(settings: GpuShadowSettings): number {
    return Math.min(shadowedLightBudgetOf(settings), lightCountOf(settings.maxPointShadows, MAX_POINT_SHADOWS));
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
