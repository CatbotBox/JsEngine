import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/engineComponentSchemas";
import {GpuMeshPassSettings, LINEAR_TEXTURE_FILTERING, NEAREST_TEXTURE_FILTERING} from "./gpuMeshPassSettings";
import {GpuSurfaceShader} from "./gpuSurfaceShader";

export function registerGpuComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(GpuMeshPassSettings, "GpuMeshPassSettings")
        .enum("textureFiltering", {nearest: NEAREST_TEXTURE_FILTERING, linear: LINEAR_TEXTURE_FILTERING})
        .number("orthographicDepthRange")
        .integer("evictUnusedMeshAfterFrames")
        .number("lodTrianglesPerPixel")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
    registry.register(componentSchema(GpuSurfaceShader, "GpuSurfaceShader")
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
        .build());
}
