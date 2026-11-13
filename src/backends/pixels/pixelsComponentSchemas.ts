import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {PixelRenderSettings} from "./pixelRenderSettings";
import {SpritePixelPassSettings} from "./2d/spritePixelPassSettings";
import {MeshPixelPassSettings} from "./3d/meshPixelPassSettings";

export function registerPixelsComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(PixelRenderSettings, "PixelRenderSettings")
        .rgb("backgroundColor")
        .number("pixelsPerScreenUnitX")
        .build());
    registry.register(componentSchema(SpritePixelPassSettings, "SpritePixelPassSettings")
        .number("maxDepthFade")
        .build());
    registry.register(componentSchema(MeshPixelPassSettings, "MeshPixelPassSettings")
        .number("maxDepthFade")
        .integer("supersampleX")
        .integer("supersampleY")
        .number("threadTriangleThreshold")
        .number("threadAreaThreshold")
        .boolean("textures")
        .boolean("lod")
        .number("lodBias")
        .number("lodTrianglesPerPixel")
        .build());
}
