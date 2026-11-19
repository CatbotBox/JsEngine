import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/engineComponentSchemas";
import {CellRenderSettings} from "./cellRenderSettings";
import {CellAspectRatio} from "./cellAspectRatio";
import {SpriteCellPassSettings} from "./2d/spriteCellPassSettings";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

export function registerCellsComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(CellRenderSettings, "CellRenderSettings")
        .string("backgroundGlyph")
        .textColor("backgroundGlyphColor")
        .textColor("backgroundColor")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
    registry.register(componentSchema(SpriteCellPassSettings, "SpriteCellPassSettings")
        .number("maxDepthFade")
        .integer("colorQuantMask")
        .rgb("backgroundColor")
        .boolean("halfBlockCells")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
    registry.register(componentSchema(MeshCellPassSettings, "MeshCellPassSettings")
        .number("maxDepthFade")
        .integer("colorQuantMask")
        .rgb("backgroundColor")
        .number("threadTriangleThreshold")
        .number("threadAreaThreshold")
        .boolean("halfBlockCells")
        .number("lodTrianglesPerCell")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build());
    registry.register(componentSchema(CellAspectRatio, "CellAspectRatio").implied().category(ENGINE_COMPONENT_CATEGORIES.camera).build());
}
