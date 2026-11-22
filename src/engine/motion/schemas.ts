import {ENGINE_COMPONENT_CATEGORIES} from "../scene/componentCategories";
import {componentSchema} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {Lifetime} from "./lifetime";
import {Velocity} from "./velocity";

export const VELOCITY_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Velocity, "Velocity").number("xUnitsPerSecond").number("yUnitsPerSecond").number("zUnitsPerSecond")
        .category(ENGINE_COMPONENT_CATEGORIES.motion).build(),
};

export const LIFETIME_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Lifetime, "Lifetime").number("durationMs").number("remainingMs").category(ENGINE_COMPONENT_CATEGORIES.motion).build(),
};
