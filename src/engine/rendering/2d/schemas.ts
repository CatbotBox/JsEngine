import {ENGINE_COMPONENT_CATEGORIES} from "../../scene/componentCategories";
import {componentSchema, structFields} from "../../scene/componentSchemaBuilder";
import type {StructFieldType} from "../../scene/fieldSchema";
import type {SchemaEntry} from "../../scene/schemaEntries";
import {Sprite} from "./sprite";
import {SPRITE_IMAGE_ASSET_TYPE} from "./spriteImageAssetType";
import {SpritePattern, SpritePatternColor} from "./spritePattern";

export const SPRITE_PATTERN_COLOR_TYPE_NAME = "SpritePatternColor";

export function spritePatternColorFieldType(): StructFieldType {
    return {
        kind: "struct",
        typeName: SPRITE_PATTERN_COLOR_TYPE_NAME,
        fields: structFields<SpritePatternColor>().string("char").rgb("rgb").build(),
        create: () => new SpritePatternColor(),
    };
}

export const SPRITE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Sprite, "Sprite").spriteImage("image").rgb("tint").number("opacity").category(ENGINE_COMPONENT_CATEGORIES.rendering2d).build(),
};

export const SPRITE_PATTERN_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(SpritePattern, "SpritePattern").textLines("rows").list("palette", spritePatternColorFieldType()).category(ENGINE_COMPONENT_CATEGORIES.rendering2d).build(),
};

export const SPRITE_IMAGE_ASSET_TYPE_ENTRY: SchemaEntry = {kind: "assetType", type: SPRITE_IMAGE_ASSET_TYPE};
