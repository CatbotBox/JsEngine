import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerSchemaEntries} from "../../engine/scene/schemaEntries";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import {SPRITE_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY} from "./2d/schemas";
import {MESH_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY} from "./3d/schemas";
import {PIXEL_RENDER_SETTINGS_SCHEMA_ENTRY} from "./schemas";

export const PIXELS_SCHEMAS: readonly SchemaEntry[] = [PIXEL_RENDER_SETTINGS_SCHEMA_ENTRY, SPRITE_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY, MESH_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY];

export function registerPixelsComponentSchemas(registry: ComponentSchemaRegistry): void {
    registerSchemaEntries(registry, PIXELS_SCHEMAS);
}
