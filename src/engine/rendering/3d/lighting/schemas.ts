import {ENGINE_COMPONENT_CATEGORIES} from "../../../scene/componentCategories";
import {componentSchema} from "../../../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../../scene/schemaEntries";
import {AmbientLight} from "./ambientLight";
import {DirectionalLight} from "./directionalLight";
import {HemisphereLight} from "./hemisphereLight";
import {PointLight} from "./pointLight";
import {RectAreaLight} from "./rectAreaLight";
import {SphereAreaLight} from "./sphereAreaLight";
import {SpotLight} from "./spotLight";
import {TubeAreaLight} from "./tubeAreaLight";

export const DIRECTIONAL_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(DirectionalLight, "DirectionalLight").rgb("color").number("intensity").boolean("castsShadows").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const POINT_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(PointLight, "PointLight").number("range").rgb("color").number("intensity").boolean("castsShadows").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const AMBIENT_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(AmbientLight, "AmbientLight").rgb("color").number("intensity").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const SPOT_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(SpotLight, "SpotLight").number("range").number("innerConeAngle").number("outerConeAngle").rgb("color").number("intensity").boolean("castsShadows")
        .category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const SPHERE_AREA_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(SphereAreaLight, "SphereAreaLight").number("range").number("radius").rgb("color").number("intensity").boolean("castsShadows")
        .category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const TUBE_AREA_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(TubeAreaLight, "TubeAreaLight").number("range").number("length").number("radius").rgb("color").number("intensity").boolean("castsShadows")
        .category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const RECT_AREA_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(RectAreaLight, "RectAreaLight").number("range").number("width").number("height").rgb("color").number("intensity").boolean("castsShadows")
        .category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};

export const HEMISPHERE_LIGHT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(HemisphereLight, "HemisphereLight").rgb("skyColor").rgb("groundColor").number("intensity").category(ENGINE_COMPONENT_CATEGORIES.lighting).build(),
};
