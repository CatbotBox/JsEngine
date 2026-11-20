import {ComponentSchemaRegistry, registerEngineComponentSchemas, registerSchemaEntries} from "../scene";
import type {SchemaEntry} from "../scene";

export type SchemaRegistration = (registry: ComponentSchemaRegistry) => void;

export interface ProjectSchemaSources {
    readonly backendSchemas?: readonly SchemaRegistration[];
    readonly schemas?: readonly SchemaEntry[];
}

const NO_SCHEMA_SOURCES: ProjectSchemaSources = {};

export function createProjectSchemaRegistry(sources: ProjectSchemaSources = NO_SCHEMA_SOURCES): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    for (const registerBackendSchemas of sources.backendSchemas ?? []) registerBackendSchemas(registry);
    registerSchemaEntries(registry, sources.schemas ?? []);
    return registry;
}
