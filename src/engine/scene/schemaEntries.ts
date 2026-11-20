import type {Component, ComponentCtor, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import type {FieldAlias, FieldSchema, FieldTypeCodec, FieldTypeDefinition} from "./fieldSchema";

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

type FieldTypingEntry = FieldAliasEntry | FieldTypeEntry;

export type SchemaEntry =
    | GeneratedComponentEntry
    | GeneratedResourceEntry
    | ComponentClassEntry
    | ResourceClassEntry
    | FieldTypingEntry;

function isFieldTypingEntry(entry: SchemaEntry): entry is FieldTypingEntry {
    return entry.kind === "fieldAlias" || entry.kind === "fieldType";
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
    for (const entry of entries) if (isFieldTypingEntry(entry)) registerSchemaEntry(registry, entry);
    for (const entry of entries) if (!isFieldTypingEntry(entry)) registerSchemaEntry(registry, entry);
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
        case "fieldAlias":
            registry.registerFieldAlias(entry.typeName, entry.alias);
            return;
        case "fieldType":
            registry.registerFieldType(namedFieldType(entry.typeName, entry.definition));
            return;
    }
}
