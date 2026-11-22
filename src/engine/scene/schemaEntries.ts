import type {Component, ComponentCtor, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {AssetType} from "./assetTypes";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import type {ComponentSchema, FieldAlias, FieldSchema, FieldTypeCodec, FieldTypeDefinition, ResourceSchema} from "./fieldSchema";

export interface GeneratedComponentEntry {
    readonly kind: "component";
    readonly ctor: ComponentCtor<Component>;
    readonly name: string;
    readonly fields: readonly FieldSchema[];
    readonly category?: string;
}

export interface GeneratedResourceEntry {
    readonly kind: "resource";
    readonly ctor: ResourceCtor<Resource>;
    readonly name: string;
    readonly fields: readonly FieldSchema[];
}

export interface ComponentClassEntry {
    readonly kind: "componentClass";
    readonly ctor: ComponentCtor<Component>;
}

export interface ResourceClassEntry {
    readonly kind: "resourceClass";
    readonly ctor: ResourceCtor<Resource>;
}

export interface ComponentSchemaEntry {
    readonly kind: "componentSchema";

    build(): ComponentSchema;
}

export interface ResourceSchemaEntry {
    readonly kind: "resourceSchema";

    build(): ResourceSchema;
}

export interface FieldAliasEntry {
    readonly kind: "fieldAlias";
    readonly typeName: string;
    readonly alias: FieldAlias;
}

export interface FieldTypeEntry {
    readonly kind: "fieldType";
    readonly typeName: string;
    readonly definition: FieldTypeCodec;
}

export interface AssetTypeEntry {
    readonly kind: "assetType";
    readonly type: AssetType;
}

export interface OtherBackendTypesEntry {
    readonly kind: "otherBackendTypes";
    readonly names: readonly string[];
}

type PreparingEntry = FieldAliasEntry | FieldTypeEntry | AssetTypeEntry | OtherBackendTypesEntry;

export type SchemaEntry =
    | GeneratedComponentEntry
    | GeneratedResourceEntry
    | ComponentClassEntry
    | ResourceClassEntry
    | ComponentSchemaEntry
    | ResourceSchemaEntry
    | PreparingEntry;

function isPreparingEntry(entry: SchemaEntry): entry is PreparingEntry {
    switch (entry.kind) {
        case "fieldAlias":
        case "fieldType":
        case "assetType":
        case "otherBackendTypes":
            return true;
        default:
            return false;
    }
}

function namedFieldType(typeName: string, codec: FieldTypeCodec): FieldTypeDefinition {
    return {
        name: typeName,
        encode: (value, path) => codec.encode(value, path),
        decode: (json, path) => codec.decode(json, path),
        defaultValue: () => codec.defaultValue(),
    };
}

export function registerSchemaEntries(registry: ComponentSchemaRegistry, entries: readonly SchemaEntry[]): void {
    for (const entry of entries) if (isPreparingEntry(entry)) registerSchemaEntry(registry, entry);
    for (const entry of entries) if (!isPreparingEntry(entry)) registerSchemaEntry(registry, entry);
}

function registerComponentSchemaOnce(registry: ComponentSchemaRegistry, schema: ComponentSchema): void {
    if (registry.byName(schema.name)?.ctor === schema.ctor) return;
    registry.register(schema);
}

function registerResourceSchemaOnce(registry: ComponentSchemaRegistry, schema: ResourceSchema): void {
    if (registry.resourceByName(schema.name)?.ctor === schema.ctor) return;
    registry.registerResource(schema);
}

function registerAssetTypeOnce(registry: ComponentSchemaRegistry, type: AssetType): void {
    if (registry.assetType(type.name) === type) return;
    registry.registerAssetType(type);
}

function registerSchemaEntry(registry: ComponentSchemaRegistry, entry: SchemaEntry): void {
    switch (entry.kind) {
        case "component":
            registry.registerGeneratedComponent(entry.ctor, entry.name, entry.fields, {category: entry.category});
            return;
        case "resource":
            registry.registerGeneratedResource(entry.ctor, entry.name, entry.fields);
            return;
        case "componentClass":
            registry.registerComponentClass(entry.ctor);
            return;
        case "resourceClass":
            registry.registerResourceClass(entry.ctor);
            return;
        case "componentSchema":
            registerComponentSchemaOnce(registry, entry.build());
            return;
        case "resourceSchema":
            registerResourceSchemaOnce(registry, entry.build());
            return;
        case "fieldAlias":
            registry.registerFieldAlias(entry.typeName, entry.alias);
            return;
        case "fieldType":
            registry.registerFieldType(namedFieldType(entry.typeName, entry.definition));
            return;
        case "assetType":
            registerAssetTypeOnce(registry, entry.type);
            return;
        case "otherBackendTypes":
            registry.registerOtherBackendTypeNames(entry.names);
            return;
    }
}
