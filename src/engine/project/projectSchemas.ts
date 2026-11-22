import {ComponentSchemaRegistry} from "../scene/componentSchemaRegistry";
import {registerSchemaEntries} from "../scene/schemaEntries";
import type {SchemaEntry} from "../scene/schemaEntries";
import {SCENE_MANAGER_SCHEMAS} from "../scene/schemas";

export interface ProjectSchemaSources {
    readonly hostSchemas?: readonly SchemaEntry[];
    readonly schemas?: readonly SchemaEntry[];
}

const NO_SCHEMA_SOURCES: ProjectSchemaSources = {};
const NO_SCHEMAS: readonly SchemaEntry[] = [];

export function createProjectSchemaRegistry(sources: ProjectSchemaSources = NO_SCHEMA_SOURCES): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerSchemaEntries(registry, [...sources.hostSchemas ?? NO_SCHEMAS, ...sources.schemas ?? NO_SCHEMAS, ...SCENE_MANAGER_SCHEMAS]);
    return registry;
}
