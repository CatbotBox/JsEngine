import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/engineComponentSchemas";
import {PixelRenderSettings} from "./pixelRenderSettings";
import {SpritePixelPassSettings} from "./2d/spritePixelPassSettings";
import {MeshPixelPassSettings} from "./3d/meshPixelPassSettings";

export function registerPixelsComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(PixelRenderSettings, "PixelRenderSettings")
        .rgb("backgroundColor")
        .number("pixelsPerScreenUnitX")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
    registry.register(componentSchema(SpritePixelPassSettings, "SpritePixelPassSettings")
        .number("maxDepthFade")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
    registry.register(componentSchema(MeshPixelPassSettings, "MeshPixelPassSettings")
        .number("maxDepthFade")
        .number("threadTriangleThreshold")
        .number("threadAreaThreshold")
        .number("lodTrianglesPerPixel")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
}
