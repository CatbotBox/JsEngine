import * as cells2dSchemas from "../../backends/cells/2d/schemas";
import * as cellsHudSpritePasses from "../../backends/cells/2d/cellsHudSpritePasses";
import * as cellsSpritePasses from "../../backends/cells/2d/cellsSpritePasses";
import * as cellsWorldTextPasses from "../../backends/cells/2d/cellsWorldTextPasses";
import * as cells3dSchemas from "../../backends/cells/3d/schemas";
import * as cellsMeshPasses from "../../backends/cells/3d/cellsMeshPasses";
import {CELLS_SCHEMAS} from "../../backends/cells/cellsComponentSchemas";
import * as cellsHudTextPasses from "../../backends/cells/cellsHudTextPasses";
import {CELLS_PASS_LISTS} from "../../backends/cells/cellsStandardPasses";
import * as cellsSchemas from "../../backends/cells/schemas";
import {GPU_HOST_SCHEMAS, GPU_SCHEMAS} from "../../backends/gpu/gpuComponentSchemas";
import * as gpuMeshPasses from "../../backends/gpu/gpuMeshPasses";
import {GPU_PASS_LISTS} from "../../backends/gpu/gpuStandardPasses";
import * as gpuSchemas from "../../backends/gpu/schemas";
import * as pixels2dSchemas from "../../backends/pixels/2d/schemas";
import * as pixelsHudSpritePasses from "../../backends/pixels/2d/pixelsHudSpritePasses";
import * as pixelsSpritePasses from "../../backends/pixels/2d/pixelsSpritePasses";
import * as pixels3dSchemas from "../../backends/pixels/3d/schemas";
import * as pixelsMeshPasses from "../../backends/pixels/3d/pixelsMeshPasses";
import {PIXELS_SCHEMAS} from "../../backends/pixels/pixelsComponentSchemas";
import * as pixelsHudTextPasses from "../../backends/pixels/pixelsHudTextPasses";
import {PIXELS_PASS_LISTS} from "../../backends/pixels/pixelsStandardPasses";
import * as pixelsWorldTextPasses from "../../backends/pixels/pixelsWorldTextPasses";
import * as pixelsSchemas from "../../backends/pixels/schemas";
import {BUILTIN_IMAGE_DECODERS} from "../../engine/assets/image/builtinDecoders";
import type {ImageDecoderEntry} from "../../engine/assets/image/decodedImage";
import * as jpegDecoder from "../../engine/assets/image/jpeg";
import * as pngDecoder from "../../engine/assets/image/png";
import * as ppmDecoder from "../../engine/assets/image/ppm";
import * as coreSchemas from "../../engine/core/schemas";
import * as inputSchemas from "../../engine/input/schemas";
import * as randomSchema from "../../engine/math/randomSchema";
import {RANDOM_SCHEMA_ENTRY} from "../../engine/math/randomSchema";
import * as rendering2dSchemas from "../../engine/rendering/2d/schemas";
import * as lightingSchemas from "../../engine/rendering/3d/lighting/schemas";
import * as rendering3dSchemas from "../../engine/rendering/3d/schemas";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {RENDER_PASS_REQUIRED_TYPES} from "../../engine/rendering/renderPassTypes";
import * as renderingSchemas from "../../engine/rendering/schemas";
import {ENGINE_SCHEMAS} from "../../engine/scene/engineComponentSchemas";
import type {FieldSchema, FieldType} from "../../engine/scene/fieldSchema";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import * as sceneSchemas from "../../engine/scene/schemas";
import * as translationSchemas from "../../engine/translation/schemas";

export interface SourceExport {
    readonly path: readonly string[];
    readonly name: string;
}

export type CatalogRole = "component" | "resource" | "assetType";

export interface CatalogSchema {
    readonly source: SourceExport;
    readonly role: CatalogRole;
    readonly name: string;
    readonly className?: string;
    readonly assetKinds: readonly string[];
    readonly namedByCode: boolean;
}

export interface CatalogPassList {
    readonly source: SourceExport;
    readonly requiredTypes: readonly string[];
}

export interface CatalogBackend {
    readonly kind: RenderBackendKind;
    readonly hostSchemas: readonly CatalogSchema[];
    readonly passLists: readonly CatalogPassList[];
}

export interface CatalogImageDecoder {
    readonly source: SourceExport;
    readonly extensions: readonly string[];
}

interface SourceModule {
    readonly path: readonly string[];
    readonly exports: object;
}

const ENGINE_SCHEMA_MODULES: readonly SourceModule[] = [
    {path: ["engine", "core", "schemas"], exports: coreSchemas},
    {path: ["engine", "input", "schemas"], exports: inputSchemas},
    {path: ["engine", "math", "randomSchema"], exports: randomSchema},
    {path: ["engine", "rendering", "2d", "schemas"], exports: rendering2dSchemas},
    {path: ["engine", "rendering", "3d", "lighting", "schemas"], exports: lightingSchemas},
    {path: ["engine", "rendering", "3d", "schemas"], exports: rendering3dSchemas},
    {path: ["engine", "rendering", "schemas"], exports: renderingSchemas},
    {path: ["engine", "scene", "schemas"], exports: sceneSchemas},
    {path: ["engine", "translation", "schemas"], exports: translationSchemas},
];

const BACKEND_SCHEMA_MODULES: readonly SourceModule[] = [
    {path: ["backends", "cells", "schemas"], exports: cellsSchemas},
    {path: ["backends", "cells", "2d", "schemas"], exports: cells2dSchemas},
    {path: ["backends", "cells", "3d", "schemas"], exports: cells3dSchemas},
    {path: ["backends", "pixels", "schemas"], exports: pixelsSchemas},
    {path: ["backends", "pixels", "2d", "schemas"], exports: pixels2dSchemas},
    {path: ["backends", "pixels", "3d", "schemas"], exports: pixels3dSchemas},
    {path: ["backends", "gpu", "schemas"], exports: gpuSchemas},
];

const PASS_LIST_MODULES: readonly SourceModule[] = [
    {path: ["backends", "cells", "3d", "cellsMeshPasses"], exports: cellsMeshPasses},
    {path: ["backends", "cells", "2d", "cellsSpritePasses"], exports: cellsSpritePasses},
    {path: ["backends", "cells", "2d", "cellsWorldTextPasses"], exports: cellsWorldTextPasses},
    {path: ["backends", "cells", "2d", "cellsHudSpritePasses"], exports: cellsHudSpritePasses},
    {path: ["backends", "cells", "cellsHudTextPasses"], exports: cellsHudTextPasses},
    {path: ["backends", "pixels", "3d", "pixelsMeshPasses"], exports: pixelsMeshPasses},
    {path: ["backends", "pixels", "2d", "pixelsSpritePasses"], exports: pixelsSpritePasses},
    {path: ["backends", "pixels", "pixelsWorldTextPasses"], exports: pixelsWorldTextPasses},
    {path: ["backends", "pixels", "2d", "pixelsHudSpritePasses"], exports: pixelsHudSpritePasses},
    {path: ["backends", "pixels", "pixelsHudTextPasses"], exports: pixelsHudTextPasses},
    {path: ["backends", "gpu", "gpuMeshPasses"], exports: gpuMeshPasses},
];

const IMAGE_DECODER_MODULES: readonly SourceModule[] = [
    {path: ["engine", "assets", "image", "png"], exports: pngDecoder},
    {path: ["engine", "assets", "image", "ppm"], exports: ppmDecoder},
    {path: ["engine", "assets", "image", "jpeg"], exports: jpegDecoder},
];

const NAMED_BY_CODE = true;
const NAMED_BY_DATA_ONLY = false;

const BACKEND_HOST_SCHEMAS: Readonly<Record<RenderBackendKind, readonly SchemaEntry[]>> = {
    cells: CELLS_SCHEMAS,
    pixels: PIXELS_SCHEMAS,
    gpu: GPU_HOST_SCHEMAS,
};

const EVERY_BACKEND_SCHEMA: readonly SchemaEntry[] = [...CELLS_SCHEMAS, ...PIXELS_SCHEMAS, ...GPU_SCHEMAS];

const BACKEND_PASS_LISTS: Readonly<Record<RenderBackendKind, readonly (readonly RenderPassCtor[])[]>> = {
    cells: CELLS_PASS_LISTS,
    pixels: PIXELS_PASS_LISTS,
    gpu: GPU_PASS_LISTS,
};

function sourceExportOf(modules: readonly SourceModule[], value: unknown, label: string): SourceExport {
    for (const module of modules) {
        const name = Object.keys(module.exports).find(key => (module.exports as Readonly<Record<string, unknown>>)[key] === value);
        if (name !== undefined) return {path: module.path, name};
    }
    throw new Error(`the toolchain catalog lists no module exporting ${label}; add its module to engineCatalog.ts`);
}

function collectAssetKinds(type: FieldType, kinds: Set<string>): void {
    switch (type.kind) {
        case "asset":
            kinds.add(type.assetType);
            return;
        case "list":
            collectAssetKinds(type.element, kinds);
            return;
        case "struct":
            for (const field of type.fields) collectAssetKinds(field, kinds);
            return;
        default:
            return;
    }
}

function assetKindsOfFields(fields: readonly FieldSchema[]): string[] {
    const kinds = new Set<string>();
    for (const field of fields) collectAssetKinds(field, kinds);
    return [...kinds];
}

const catalogSchemas = new Map<SchemaEntry, CatalogSchema>();

function catalogSchemaOnce(modules: readonly SourceModule[], entry: SchemaEntry, namedByCode: boolean): CatalogSchema {
    const known = catalogSchemas.get(entry);
    if (known !== undefined) return known;
    const schema = catalogSchema(modules, entry, namedByCode);
    catalogSchemas.set(entry, schema);
    return schema;
}

function catalogSchema(modules: readonly SourceModule[], entry: SchemaEntry, namedByCode: boolean): CatalogSchema {
    switch (entry.kind) {
        case "componentSchema":
        case "resourceSchema": {
            const schema = entry.build();
            const role: CatalogRole = entry.kind === "componentSchema" ? "component" : "resource";
            const source = sourceExportOf(modules, entry, `the ${schema.name} schema entry`);
            return {source, role, name: schema.name, className: schema.ctor.name, assetKinds: assetKindsOfFields(schema.fields), namedByCode};
        }
        case "assetType":
            return {source: sourceExportOf(modules, entry, `the ${entry.type.name} asset type entry`), role: "assetType", name: entry.type.name, assetKinds: [], namedByCode};
        default:
            throw new Error(`the toolchain catalog takes component, resource and asset type entries, not ${entry.kind}`);
    }
}

function catalogPassList(list: readonly RenderPassCtor[]): CatalogPassList {
    const requiredTypes = new Set(list.flatMap(pass => RENDER_PASS_REQUIRED_TYPES[pass.renderPass]));
    return {source: sourceExportOf(PASS_LIST_MODULES, list, `the pass list of ${list.map(pass => pass.name).join(", ")}`), requiredTypes: [...requiredTypes]};
}

function catalogBackend(kind: RenderBackendKind): CatalogBackend {
    return {
        kind,
        hostSchemas: BACKEND_HOST_SCHEMAS[kind].map(entry => catalogSchemaOnce(BACKEND_SCHEMA_MODULES, entry, NAMED_BY_CODE)),
        passLists: BACKEND_PASS_LISTS[kind].map(catalogPassList),
    };
}

function catalogImageDecoder(decoder: ImageDecoderEntry): CatalogImageDecoder {
    return {source: sourceExportOf(IMAGE_DECODER_MODULES, decoder, `the ${decoder.extensions.join("/")} image decoder`), extensions: decoder.extensions};
}

export const ENGINE_CATALOG: readonly CatalogSchema[] = [
    ...ENGINE_SCHEMAS.map(entry => catalogSchemaOnce(ENGINE_SCHEMA_MODULES, entry, NAMED_BY_CODE)),
    catalogSchemaOnce(ENGINE_SCHEMA_MODULES, RANDOM_SCHEMA_ENTRY, NAMED_BY_DATA_ONLY),
];

export const BACKEND_SCHEMA_CATALOG: readonly CatalogSchema[] = EVERY_BACKEND_SCHEMA.map(entry => catalogSchemaOnce(BACKEND_SCHEMA_MODULES, entry, NAMED_BY_CODE));

export const BACKEND_CATALOG: Readonly<Record<RenderBackendKind, CatalogBackend>> = {
    cells: catalogBackend("cells"),
    pixels: catalogBackend("pixels"),
    gpu: catalogBackend("gpu"),
};

export const ALL_CATALOG_SCHEMAS: readonly CatalogSchema[] = [...ENGINE_CATALOG, ...BACKEND_SCHEMA_CATALOG];

export const IMAGE_DECODER_CATALOG: readonly CatalogImageDecoder[] = BUILTIN_IMAGE_DECODERS.map(catalogImageDecoder);
