import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../engine/scene";
import type {ProjectEntryModule} from "./projectEntry";

export type SchemaRegistration = (registry: ComponentSchemaRegistry) => void;

export interface GeneratedProjectSchemas {
    registerGeneratedSchemas(registry: ComponentSchemaRegistry): void;
}

export interface ProjectSchemaSources {
    readonly backendSchemas?: readonly SchemaRegistration[];
    readonly generated?: GeneratedProjectSchemas;
}

const NO_SCHEMA_SOURCES: ProjectSchemaSources = {};

export function createProjectSchemaRegistry(entry: Pick<ProjectEntryModule, "registerProjectSchemas">, sources: ProjectSchemaSources = NO_SCHEMA_SOURCES): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    for (const registerBackendSchemas of sources.backendSchemas ?? []) registerBackendSchemas(registry);
    entry.registerProjectSchemas?.(registry);
    sources.generated?.registerGeneratedSchemas(registry);
    return registry;
}
