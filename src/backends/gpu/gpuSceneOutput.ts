export type GpuSceneOutput = "display" | "hdr";

export const DISPLAY_SCENE_OUTPUT: GpuSceneOutput = "display";
export const HDR_SCENE_OUTPUT: GpuSceneOutput = "hdr";
export const HDR_SCENE_FORMAT: GPUTextureFormat = "rgba16float";
export const LARGEST_HDR_SCENE_VALUE = 65504;
export const OVERRIDE_ENABLED = 1;
