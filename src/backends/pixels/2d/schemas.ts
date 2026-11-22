import {ENGINE_COMPONENT_CATEGORIES} from "../../../engine/scene/componentCategories";
import {componentSchema} from "../../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../../engine/scene/schemaEntries";
import {SpritePixelPassSettings} from "./spritePixelPassSettings";

export const SPRITE_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(SpritePixelPassSettings, "SpritePixelPassSettings")
        .number("maxDepthFade")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};
