import {ENGINE_COMPONENT_CATEGORIES} from "../../../engine/scene/componentCategories";
import {componentSchema} from "../../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../../engine/scene/schemaEntries";
import {MeshCellPassSettings} from "./meshCellPassSettings";

export const MESH_CELL_PASS_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(MeshCellPassSettings, "MeshCellPassSettings")
        .number("maxDepthFade")
        .integer("colorQuantMask")
        .integer("supersampleX")
        .integer("supersampleY")
        .rgb("backgroundColor")
        .number("threadTriangleThreshold")
        .number("threadAreaThreshold")
        .boolean("halfBlockCells")
        .number("lodTrianglesPerCell")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};
