import {ENGINE_COMPONENT_CATEGORIES} from "./componentCategories";
import {componentSchema, resourceSchema} from "./componentSchemaBuilder";
import {PREFAB_ASSET_TYPE} from "./prefabAssetType";
import {PrefabInstance} from "./prefabInstance";
import type {SchemaEntry} from "./schemaEntries";
import {ACTIVE_SCENE_RESOURCE_NAME, ActiveScene, SCENE_INSTANCE_COMPONENT_NAME, SceneInstance} from "./sceneInstance";

export const PREFAB_INSTANCE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(PrefabInstance, "PrefabInstance").string("sourcePath").textLines("overrides").category(ENGINE_COMPONENT_CATEGORIES.prefab).build(),
};

export const SCENE_INSTANCE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(SceneInstance, SCENE_INSTANCE_COMPONENT_NAME).integer("sceneId").nullableString("path").category(ENGINE_COMPONENT_CATEGORIES.scene).build(),
};

export const ACTIVE_SCENE_SCHEMA_ENTRY: SchemaEntry = {
    kind: "resourceSchema",
    build: () => resourceSchema(ActiveScene, ACTIVE_SCENE_RESOURCE_NAME).integer("sceneId").nullableString("path").build(),
};

export const PREFAB_ASSET_TYPE_ENTRY: SchemaEntry = {kind: "assetType", type: PREFAB_ASSET_TYPE};

export const SCENE_MANAGER_SCHEMAS: readonly SchemaEntry[] = [SCENE_INSTANCE_SCHEMA_ENTRY, ACTIVE_SCENE_SCHEMA_ENTRY];
