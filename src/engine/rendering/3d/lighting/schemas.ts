import {ENGINE_COMPONENT_CATEGORIES} from "../../../scene/componentCategories";
import {componentSchema} from "../../../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../../scene/schemaEntries";
import {AmbientLight} from "./ambientLight";
import {DirectionalLight} from "./directionalLight";
import {PointLight} from "./pointLight";

export const DIRECTIONAL_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(DirectionalLight, "DirectionalLight").rgb("color").number("intensity").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const POINT_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(PointLight, "PointLight").number("range").rgb("color").number("intensity").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const AMBIENT_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(AmbientLight, "AmbientLight").rgb("color").number("intensity").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};
