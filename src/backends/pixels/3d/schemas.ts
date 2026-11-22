import {ENGINE_COMPONENT_CATEGORIES} from "../../../engine/scene/componentCategories";
import {componentSchema} from "../../../engine/scene/componentSchemaBuilder";
import type {SchemaEntry} from "../../../engine/scene/schemaEntries";
import {MeshPixelPassSettings} from "./meshPixelPassSettings";

export const MESH_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY: SchemaEntry = {
    kind: "componentSchema",
    build: () => componentSchema(MeshPixelPassSettings, "MeshPixelPassSettings")
        .number("maxDepthFade")
        .integer("supersampleX")
        .integer("supersampleY")
        .number("threadTriangleThreshold")
        .number("threadAreaThreshold")
        .number("lodTrianglesPerPixel")
        .category(ENGINE_COMPONENT_CATEGORIES.settings)
        .build(),
};
