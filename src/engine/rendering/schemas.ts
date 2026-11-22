import {ENGINE_COMPONENT_CATEGORIES} from "../scene/componentCategories";
import {componentSchema} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {Camera} from "./camera";
import {HudElement} from "./hudElement";
import {RenderBounds} from "./renderBounds";
import {RenderBoundsOffset} from "./renderBoundsOffset";
import {ScreenAnchor} from "./screenAnchor";
import {ScreenSize} from "./screenSize";
import {SHADER_ASSET_TYPE} from "./shaderAssetType";
import {TextSprite} from "./textSprite";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";

export const CAMERA_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Camera, "Camera").number("nearPlaneDistance").number("farPlaneDistance").category(ENGINE_COMPONENT_CATEGORIES.camera).build(),
};

export const TEXT_SPRITE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(TextSprite, "TextSprite")
        .textLines("image").nullableString("transparentChar").textColor("foreground").textColor("background").category(ENGINE_COMPONENT_CATEGORIES.rendering2d).build(),
};

export const RENDER_BOUNDS_OFFSET_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(RenderBoundsOffset, "RenderBoundsOffset").number("x").number("y").number("z").category(ENGINE_COMPONENT_CATEGORIES.rendering).build(),
};

export const SCREEN_ANCHOR_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(ScreenAnchor, "ScreenAnchor").enum("anchorPosition", {
        "top-left": "top-left",
        "top-center": "top-center",
        "top-right": "top-right",
        "middle-left": "middle-left",
        "middle-center": "middle-center",
        "middle-right": "middle-right",
        "bottom-left": "bottom-left",
        "bottom-center": "bottom-center",
        "bottom-right": "bottom-right",
    }).category(ENGINE_COMPONENT_CATEGORIES.hud).build(),
};

export const HUD_ELEMENT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(HudElement, "HudElement").category(ENGINE_COMPONENT_CATEGORIES.hud).build(),
};

export const RENDER_BOUNDS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(RenderBounds, "RenderBounds").presenceOnly().category(ENGINE_COMPONENT_CATEGORIES.rendering).build(),
};

export const WORLD_SPACE_RENDER_BOUNDS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(WorldSpaceRenderBounds, "WorldSpaceRenderBounds").implied().category(ENGINE_COMPONENT_CATEGORIES.rendering).build(),
};

export const SCREEN_SIZE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(ScreenSize, "ScreenSize").implied().category(ENGINE_COMPONENT_CATEGORIES.camera).build(),
};

export const SHADER_ASSET_TYPE_ENTRY: SchemaEntry = {kind: "assetType", type: SHADER_ASSET_TYPE};
