import {ENGINE_COMPONENT_CATEGORIES} from "../../engine/scene/componentCategories";
import {componentSchema} from "../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import {PixelRenderSettings} from "./pixelRenderSettings";

export const PIXEL_RENDER_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(PixelRenderSettings, "PixelRenderSettings")
        .rgb("backgroundColor")
        .number("pixelsPerScreenUnitX")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};
