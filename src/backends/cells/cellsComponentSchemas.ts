import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {CellRenderSettings} from "./cellRenderSettings";
import {CellAspectRatio} from "./cellAspectRatio";
import {TextSpriteCellPassSettings} from "./2d/textSpriteCellPassSettings";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

export function registerCellsComponentSchemas(registry: ComponentSchemaRegistry): void {
    registry.register(componentSchema(CellRenderSettings, "CellRenderSettings")
        .string("backgroundGlyph")
        .textColor("backgroundGlyphColor")
        .textColor("backgroundColor")
        .build());
    registry.register(componentSchema(TextSpriteCellPassSettings, "TextSpriteCellPassSettings")
        .number("maxDepthFade")
        .integer("colorQuantMask")
        .rgb("backgroundColor")
        .boolean("halfBlockCells")
        .build());
    registry.register(componentSchema(MeshCellPassSettings, "MeshCellPassSettings")
        .number("maxDepthFade")
        .integer("colorQuantMask")
        .integer("supersampleX")
        .integer("supersampleY")
        .rgb("backgroundColor")
        .number("threadTriangleThreshold")
        .number("threadAreaThreshold")
        .boolean("textures")
        .boolean("halfBlockCells")
        .boolean("lod")
        .number("lodBias")
        .number("lodTrianglesPerCell")
        .build());
    registry.register(componentSchema(CellAspectRatio, "CellAspectRatio").implied().build());
}
