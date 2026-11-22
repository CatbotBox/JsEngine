import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/componentCategories";
import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import {CellAspectRatio} from "./cellAspectRatio";
import {CellRenderSettings} from "./cellRenderSettings";

export const CELL_RENDER_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(CellRenderSettings, "CellRenderSettings")
        .string("backgroundGlyph")
        .textColor("backgroundGlyphColor")
        .textColor("backgroundColor")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};

export const CELL_ASPECT_RATIO_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(CellAspectRatio, "CellAspectRatio").implied().category(ENGINE_COMPONENT_CATEGORIES.camera).build(),
};
