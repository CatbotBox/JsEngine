import {INPUT_MAP_SCHEMA} from "../scene/inputMapSchema";
import type {SchemaEntry} from "../scene/schemaEntries";

export const INPUT_MAP_SCHEMA_ENTRY: SchemaEntry = {kind: "resourceSchema", build: () => INPUT_MAP_SCHEMA};
