import {NULL_ENTITY} from "../core/entity";
import {ENGINE_COMPONENT_CATEGORIES} from "../scene/componentCategories";
import {componentSchema} from "../scene/componentSchemaBuilder";
import type {EntityFieldOptions} from "../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../scene/schemaEntries";
import {PARENT_COMPONENT_NAME, PARENT_ENTITY_KEY} from "../scene/sceneSerialization";
import {Children} from "./children";
import {EulerAngles} from "./eulerAngles";
import {InterpolatedTransform, InterpolatedTransformSnap} from "./interpolatedTransform";
import {LocalPosition} from "./localPosition";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {LocalToWorld} from "./localToWorld";
import {Parent, ParentTransform} from "./parent";

const REQUIRED_ENTITY: EntityFieldOptions = {nullable: false};

export const LOCAL_POSITION_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(LocalPosition, "LocalPosition").vec3("xyz").category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const LOCAL_ROTATION_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(LocalRotation, "LocalRotation").rotation("xyzw").category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const LOCAL_SCALE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(LocalScale, "LocalScale").vec3("xyz").category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const EULER_ANGLES_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(EulerAngles, "EulerAngles").vec3("radians").category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const PARENT_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Parent, PARENT_COMPONENT_NAME).entity(PARENT_ENTITY_KEY, REQUIRED_ENTITY)
        .create(() => new Parent(NULL_ENTITY)).category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const LOCAL_TO_WORLD_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(LocalToWorld, "LocalToWorld").presenceOnly().category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const PARENT_TRANSFORM_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(ParentTransform, "ParentTransform").implied().category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const INTERPOLATED_TRANSFORM_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(InterpolatedTransform, "InterpolatedTransform").boolean("enabled").category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const INTERPOLATED_TRANSFORM_SNAP_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(InterpolatedTransformSnap, "InterpolatedTransformSnap").implied().category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};

export const CHILDREN_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(Children, "Children").implied().category(ENGINE_COMPONENT_CATEGORIES.transform).build(),
};
