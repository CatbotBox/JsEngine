import {ENGINE_COMPONENT_CATEGORIES} from "../../../engine/scene/componentCategories";
import {componentSchema} from "../../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../../engine/scene/schemaEntries";
import {SpriteCellPassSettings} from "./spriteCellPassSettings";

export const SPRITE_CELL_PASS_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(SpriteCellPassSettings, "SpriteCellPassSettings")
        .number("maxDepthFade")
        .integer("colorQuantMask")
        .rgb("backgroundColor")
        .boolean("halfBlockCells")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};
