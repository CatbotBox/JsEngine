import {ENGINE_COMPONENT_CATEGORIES} from "../scene/componentCategories";
import {componentSchema} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {PanCamera} from "./2d/panCamera";
import {FlyCamera} from "./3d/flyCamera";

export const PAN_CAMERA_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(PanCamera, "PanCamera").number("stepXUnits").number("stepYUnits").category(ENGINE_COMPONENT_CATEGORIES.camera).build(),
};

export const FLY_CAMERA_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(FlyCamera, "FlyCamera")
        .number("yawRad").number("pitchRad").number("moveStepUnits").number("lookRadPerUnit").number("pitchMarginRad")
        .number("fovKeyStep").number("fovWheelStep").number("minFovDegrees").number("maxFovDegrees")
        .category(ENGINE_COMPONENT_CATEGORIES.camera).build(),
};
