import * as cells from "../../backends/cells";
import * as cells2d from "../../backends/cells/2d";
import * as cells3d from "../../backends/cells/3d";
import {CELLS_SCHEMAS} from "../../backends/cells/cellsComponentSchemas";
import {CELLS_PASS_LISTS} from "../../backends/cells/cellsStandardPasses";
import * as gpu from "../../backends/gpu";
import {GPU_HOST_SCHEMAS, GPU_SCHEMAS} from "../../backends/gpu/gpuComponentSchemas";
import {GPU_PASS_LISTS} from "../../backends/gpu/gpuStandardPasses";
import * as pixels from "../../backends/pixels";
import * as pixels2d from "../../backends/pixels/2d";
import * as pixels3d from "../../backends/pixels/3d";
import {PIXELS_SCHEMAS} from "../../backends/pixels/pixelsComponentSchemas";
import {PIXELS_PASS_LISTS} from "../../backends/pixels/pixelsStandardPasses";
import * as assets from "../../engine/assets";
import {BUILTIN_IMAGE_DECODERS} from "../../engine/assets/image/builtinDecoders";
import type {ImageDecoderEntry} from "../../engine/assets/image/decodedImage";
import * as cameraControllers2d from "../../engine/cameraControllers/2d";
import * as cameraControllers3d from "../../engine/cameraControllers/3d";
import * as core from "../../engine/core";
import * as input from "../../engine/input";
import * as math from "../../engine/math";
import {RANDOM_SCHEMA_ENTRY} from "../../engine/math/randomSchema";
import * as motion from "../../engine/motion";
import * as rendering from "../../engine/rendering";
import * as rendering2d from "../../engine/rendering/2d";
import * as rendering3d from "../../engine/rendering/3d";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {RENDER_PASS_REQUIRED_TYPES} from "../../engine/rendering/renderPassTypes";
import * as scene from "../../engine/scene";
import {ENGINE_SCHEMAS} from "../../engine/scene/engineComponentSchemas";
import type {FieldSchema, FieldType} from "../../engine/scene/fieldSchema";
import type {SchemaEntry} from "../../engine/scene/schemaEntries";
import * as translation from "../../engine/translation";
import * as ui from "../../engine/ui";

export interface SourceExport {
    readonly entryPoint: string;
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
    readonly entryPoint: string;
    readonly exports: object;
}

const ENGINE_SCHEMA_MODULES: readonly SourceModule[] = [
    {entryPoint: "engine/cameraControllers/2d", exports: cameraControllers2d},
    {entryPoint: "engine/cameraControllers/3d", exports: cameraControllers3d},
    {entryPoint: "engine/core", exports: core},
    {entryPoint: "engine/input", exports: input},
    {entryPoint: "engine/math", exports: math},
    {entryPoint: "engine/motion", exports: motion},
    {entryPoint: "engine/rendering/2d", exports: rendering2d},
    {entryPoint: "engine/rendering/3d", exports: rendering3d},
    {entryPoint: "engine/rendering", exports: rendering},
    {entryPoint: "engine/scene", exports: scene},
    {entryPoint: "engine/translation", exports: translation},
    {entryPoint: "engine/ui", exports: ui},
];

const BACKEND_SCHEMA_MODULES: readonly SourceModule[] = [
    {entryPoint: "backends/cells", exports: cells},
    {entryPoint: "backends/cells/2d", exports: cells2d},
    {entryPoint: "backends/cells/3d", exports: cells3d},
    {entryPoint: "backends/pixels", exports: pixels},
    {entryPoint: "backends/pixels/2d", exports: pixels2d},
    {entryPoint: "backends/pixels/3d", exports: pixels3d},
    {entryPoint: "backends/gpu", exports: gpu},
];

const PASS_LIST_MODULES: readonly SourceModule[] = [
    {entryPoint: "backends/cells/2d", exports: cells2d},
    {entryPoint: "backends/cells/3d", exports: cells3d},
    {entryPoint: "backends/cells", exports: cells},
    {entryPoint: "backends/pixels/2d", exports: pixels2d},
    {entryPoint: "backends/pixels/3d", exports: pixels3d},
    {entryPoint: "backends/pixels", exports: pixels},
    {entryPoint: "backends/gpu", exports: gpu},
];

const IMAGE_DECODER_MODULES: readonly SourceModule[] = [
    {entryPoint: "engine/assets", exports: assets},
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
        if (name !== undefined) return {entryPoint: module.entryPoint, name};
    }
    throw new Error(`no engine entry point exports ${label}; export it from its area's barrel and list that barrel in engineCatalog.ts`);
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
