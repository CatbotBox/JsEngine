import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerSchemaEntries} from "../../engine/scene/schemaEntries";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import {SPRITE_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY} from "../pixels/2d/schemas";
import {PIXEL_RENDER_SETTINGS_SCHEMA_ENTRY} from "../pixels/schemas";
import {
    GPU_MESH_PASS_SETTINGS_SCHEMA_ENTRY,
    GPU_POST_PROCESS_SETTINGS_SCHEMA_ENTRY,
    GPU_SHADOW_SETTINGS_SCHEMA_ENTRY,
    GPU_SURFACE_SHADER_SCHEMA_ENTRY,
} from "./schemas";

export const GPU_SCHEMAS: readonly SchemaEntry[] = [
    GPU_MESH_PASS_SETTINGS_SCHEMA_ENTRY,
    GPU_SURFACE_SHADER_SCHEMA_ENTRY,
    GPU_SHADOW_SETTINGS_SCHEMA_ENTRY,
    GPU_POST_PROCESS_SETTINGS_SCHEMA_ENTRY,
];

export const GPU_HOST_SCHEMAS: readonly SchemaEntry[] = [
    PIXEL_RENDER_SETTINGS_SCHEMA_ENTRY,
    SPRITE_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY,
    GPU_MESH_PASS_SETTINGS_SCHEMA_ENTRY,
    GPU_SURFACE_SHADER_SCHEMA_ENTRY,
    GPU_SHADOW_SETTINGS_SCHEMA_ENTRY,
    GPU_POST_PROCESS_SETTINGS_SCHEMA_ENTRY,
];

export function registerGpuComponentSchemas(registry: ComponentSchemaRegistry): void {
    registerSchemaEntries(registry, GPU_SCHEMAS);
}
