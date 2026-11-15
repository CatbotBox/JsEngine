import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/engineComponentSchemas";
import {
    GpuMeshPassSettings,
    LINEAR_TEXTURE_FILTERING,
    MULTISAMPLE_COUNT,
    NEAREST_TEXTURE_FILTERING,
    SINGLE_SAMPLE_COUNT,
} from "./gpuMeshPassSettings";

export function registerGpuComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(GpuMeshPassSettings, "GpuMeshPassSettings")
        .boolean("textures")
        .enum("textureFiltering", {nearest: NEAREST_TEXTURE_FILTERING, linear: LINEAR_TEXTURE_FILTERING})
        .enum("sampleCount", {single: SINGLE_SAMPLE_COUNT, multisample4: MULTISAMPLE_COUNT})
        .number("orthographicDepthRange")
        .integer("evictUnusedMeshAfterFrames")
        .boolean("lod")
        .number("lodBias")
        .number("lodTrianglesPerPixel")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
}
