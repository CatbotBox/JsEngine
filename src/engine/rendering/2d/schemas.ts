import {ENGINE_COMPONENT_CATEGORIES} from "../../scene/componentCategories";
import {componentSchema} from "../../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../scene/schemaEntries";
import {Sprite} from "./sprite";
import {SPRITE_IMAGE_ASSET_TYPE} from "./spriteImageAssetType";

export {SPRITE_PATTERN_COLOR_TYPE_NAME, spritePatternColorFieldType} from "./spritePatternFile";

export const SPRITE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Sprite, "Sprite").spriteImage("image").rgb("tint").number("opacity").category(ENGINE_COMPONENT_CATEGORIES.rendering2d).build(),
};

export const SPRITE_IMAGE_ASSET_TYPE_ENTRY: SchemaEntry = {kind: "assetType", type: SPRITE_IMAGE_ASSET_TYPE};
