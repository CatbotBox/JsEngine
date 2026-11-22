import {ENGINE_COMPONENT_CATEGORIES} from "../scene/componentCategories";
import {componentSchema} from "../scene/componentSchemaBuilder";
import type {NumberFieldBuildOptions} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {FrameLoopSettings} from "./frameLoopSettings";

const UNCAPPED_RATE: NumberFieldBuildOptions = {uncapped: true};

export const FRAME_LOOP_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(FrameLoopSettings, "FrameLoopSettings").number("simulationTickRate").number("renderRate", UNCAPPED_RATE)
        .boolean("matchDisplay").number("cpuRenderRateLimit", UNCAPPED_RATE).integer("maxCatchUpTicks").category(ENGINE_COMPONENT_CATEGORIES.settings).build(),
};
