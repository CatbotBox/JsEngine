import {resourceSchema} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {Random} from "./random";

export const RANDOM_RESOURCE_NAME = "Random";

export const RANDOM_SCHEMA_ENTRY: SchemaEntry = {
    kind: "resourceSchema",
    build: () => resourceSchema(Random, RANDOM_RESOURCE_NAME).nullableInteger("seed").build(),
};
