import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/componentCategories";
import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import {
    GpuMeshPassSettings,
    LINEAR_TEXTURE_FILTERING,
    MULTISAMPLE_COUNT,
    NEAREST_TEXTURE_FILTERING,
    SINGLE_SAMPLE_COUNT,
} from "./gpuMeshPassSettings";
import {GpuSurfaceShader} from "./gpuSurfaceShader";

export const GPU_MESH_PASS_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(GpuMeshPassSettings, "GpuMeshPassSettings")
        .enum("textureFiltering", {nearest: NEAREST_TEXTURE_FILTERING, linear: LINEAR_TEXTURE_FILTERING})
        .enum("sampleCount", {single: SINGLE_SAMPLE_COUNT, multisample4: MULTISAMPLE_COUNT})
        .number("orthographicDepthRange")
        .integer("evictUnusedAfterFrames")
        .number("lodTrianglesPerPixel")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};

export const GPU_SURFACE_SHADER_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(GpuSurfaceShader, "GpuSurfaceShader")
        .string("name")
        .number("param0")
        .number("param1")
        .number("param2")
        .number("param3")
        .number("param4")
        .number("param5")
        .number("param6")
        .number("param7")
        .category(ENGINE_COMPONENT_CATEGORIES.rendering3d)
        .build(),
};
