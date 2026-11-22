import {ENGINE_COMPONENT_CATEGORIES} from "../../scene/componentCategories";
import {componentSchema} from "../../scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../scene/schemaEntries";
import {FaceCulling} from "./faceCulling";
import {FieldOfView} from "./fieldOfView";
import {MESH_ASSET_TYPE} from "./meshAssetType";
import {MeshRenderSettings} from "./meshRenderSettings";
import {RenderMesh} from "./renderMesh";

export const FIELD_OF_VIEW_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(FieldOfView, "FieldOfView").number("radians").category(ENGINE_COMPONENT_CATEGORIES.camera).build(),
};

export const RENDER_MESH_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(RenderMesh, "RenderMesh").mesh("mesh").rgb("color").enum("faceCulling", {
        BackFaces: FaceCulling.BackFaces,
        FrontFaces: FaceCulling.FrontFaces,
        None: FaceCulling.None,
    }).category(ENGINE_COMPONENT_CATEGORIES.rendering3d).build(),
};

export const MESH_RENDER_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(MeshRenderSettings, "MeshRenderSettings").boolean("textures").boolean("lod").number("lodBias")
        .category(ENGINE_COMPONENT_CATEGORIES.settings).build(),
};

export const MESH_ASSET_TYPE_ENTRY: SchemaEntry = {kind: "assetType", type: MESH_ASSET_TYPE};
