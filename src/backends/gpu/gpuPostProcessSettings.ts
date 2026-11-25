import {Component} from "../../engine/core";
import {nonNegativeOrZero} from "./gpuShadowSettings";

export type GpuToneMapping = "aces" | "agx" | "reinhard";

export const ACES_TONE_MAPPING: GpuToneMapping = "aces";
export const AGX_TONE_MAPPING: GpuToneMapping = "agx";
export const REINHARD_TONE_MAPPING: GpuToneMapping = "reinhard";
export const NO_BLOOM_LEVELS = 0;
const DEFAULT_EXPOSURE = 1;
const DEFAULT_BLOOM_ENABLED = true;
const DEFAULT_BLOOM_THRESHOLD = 1;
const DEFAULT_BLOOM_KNEE = 0.5;
const DEFAULT_BLOOM_INTENSITY = 0.08;
const DEFAULT_BLOOM_MIP_LEVELS = 6;

export class GpuPostProcessSettings extends Component {
    public exposure: number = DEFAULT_EXPOSURE;
    public toneMapping: GpuToneMapping = ACES_TONE_MAPPING;
    public bloomEnabled: boolean = DEFAULT_BLOOM_ENABLED;
    public bloomThreshold: number = DEFAULT_BLOOM_THRESHOLD;
    public bloomKnee: number = DEFAULT_BLOOM_KNEE;
    public bloomIntensity: number = DEFAULT_BLOOM_INTENSITY;
    public bloomMipLevels: number = DEFAULT_BLOOM_MIP_LEVELS;
}

export function toneMappingOf(settings: GpuPostProcessSettings): GpuToneMapping {
    switch (settings.toneMapping) {
        case AGX_TONE_MAPPING:
        case REINHARD_TONE_MAPPING:
            return settings.toneMapping;
        default:
            return ACES_TONE_MAPPING;
    }
}

export function requestedBloomLevelsOf(settings: GpuPostProcessSettings): number {
    if (!settings.bloomEnabled || !(settings.bloomIntensity > 0) || !Number.isFinite(settings.bloomMipLevels)) return NO_BLOOM_LEVELS;
    return Math.floor(nonNegativeOrZero(settings.bloomMipLevels));
}
