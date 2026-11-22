import {CELLS_SCHEMAS} from "../../backends/cells/cellsComponentSchemas";
import {GPU_SCHEMAS} from "../../backends/gpu/gpuComponentSchemas";
import {PIXELS_SCHEMAS} from "../../backends/pixels/pixelsComponentSchemas";
import {ENGINE_SCHEMAS} from "../../engine/scene/engineComponentSchemas";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";

export const EDITOR_SCHEMAS: readonly SchemaEntry[] = [...ENGINE_SCHEMAS, ...CELLS_SCHEMAS, ...PIXELS_SCHEMAS, ...GPU_SCHEMAS];
