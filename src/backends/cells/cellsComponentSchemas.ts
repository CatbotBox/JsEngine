import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {registerSchemaEntries} from "../../engine/scene/schemaEntries";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import {SPRITE_CELL_PASS_SETTINGS_SCHEMA_ENTRY} from "./2d/schemas";
import {MESH_CELL_PASS_SETTINGS_SCHEMA_ENTRY} from "./3d/schemas";
import {CELL_ASPECT_RATIO_SCHEMA_ENTRY, CELL_RENDER_SETTINGS_SCHEMA_ENTRY} from "./schemas";

export const CELLS_SCHEMAS: readonly SchemaEntry[] = [
    CELL_RENDER_SETTINGS_SCHEMA_ENTRY,
    SPRITE_CELL_PASS_SETTINGS_SCHEMA_ENTRY,
    MESH_CELL_PASS_SETTINGS_SCHEMA_ENTRY,
    CELL_ASPECT_RATIO_SCHEMA_ENTRY,
];

export function registerCellsComponentSchemas(registry: ComponentSchemaRegistry): void {
    registerSchemaEntries(registry, CELLS_SCHEMAS);
}
