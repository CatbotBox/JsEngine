import type {Component, ComponentCtor, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {AssetType} from "./assetTypes";
import type {SceneJsonValue} from "./sceneDocument";

export const DEFAULT_COMPONENT_CATEGORY = "Game";
export const STATIC_SCHEMA_KEY = "schema";
export const MESH_ASSET_TYPE_NAME = "mesh";
export const SPRITE_IMAGE_ASSET_TYPE_NAME = "spriteImage";
export const PREFAB_ASSET_TYPE_NAME = "prefab";
export const SHADER_ASSET_TYPE_NAME = "shader";
export const PREFAB_FILE_SUFFIX = ".prefab.json";
export const BUILT_IN_ASSET_SCHEME = "builtin:";

export function builtInAssetPath(name: string): string {
    return BUILT_IN_ASSET_SCHEME + name;
}

export function isBuiltInAssetPath(path: string): boolean {
    return path.startsWith(BUILT_IN_ASSET_SCHEME);
}

export const UNIT_CUBE_MESH_PATH = builtInAssetPath("cube");
export const BUILT_IN_MESH_PATHS: readonly string[] = [UNIT_CUBE_MESH_PATH];

export type PlainFieldKind = "boolean" | "textLines" | "vec2" | "vec3" | "rotation" | "rgb" | "textColor";

export type ComponentPersistence = "fields" | "presenceOnly" | "implied";

export type EnumValue = string | number;

export interface EnumMember {
    readonly name: string;
    readonly value: EnumValue;
}

export interface NumberFieldOptions {
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly slider?: boolean;
    readonly unit?: string;
}

export interface NumberFieldType {
    readonly kind: "number";
    readonly nullable?: boolean;
    readonly uncapped?: boolean;
    readonly typeName?: string;
    readonly options?: NumberFieldOptions;
}

export interface IntegerFieldType {
    readonly kind: "integer";
    readonly nullable?: boolean;
    readonly typeName?: string;
    readonly options?: NumberFieldOptions;
}

export interface PlainFieldType {
    readonly kind: PlainFieldKind;
}

export interface StringFieldType {
    readonly kind: "string";
    readonly nullable: boolean;
    readonly typeName?: string;
}

export interface EnumFieldType {
    readonly kind: "enum";
    readonly members: readonly EnumMember[];
    readonly typeName?: string;
}

export interface EntityFieldType {
    readonly kind: "entity";
    readonly nullable: boolean;
}

export interface AssetFieldType {
    readonly kind: "asset";
    readonly assetType: string;
}

export interface ListFieldType {
    readonly kind: "list";
    readonly element: FieldType;
}

export interface StructFieldType {
    readonly kind: "struct";
    readonly typeName?: string;
    readonly fields: readonly FieldSchema[];
    readonly create?: () => object;
}

export interface CustomFieldType {
    readonly kind: "custom";
    readonly typeName: string;
}

export type FieldType =
    | NumberFieldType
    | IntegerFieldType
    | PlainFieldType
    | StringFieldType
    | EnumFieldType
    | EntityFieldType
    | AssetFieldType
    | ListFieldType
    | StructFieldType
    | CustomFieldType;

export type FieldKind = FieldType["kind"];

export interface FieldKeyed {
    readonly key: string;
}

export type FieldSchema = FieldType & FieldKeyed;
export type PlainFieldSchema = PlainFieldType & FieldKeyed;
export type StringFieldSchema = StringFieldType & FieldKeyed;
export type EntityFieldSchema = EntityFieldType & FieldKeyed;
export type EnumFieldSchema = EnumFieldType & FieldKeyed;

export interface FieldTypeCodec<V = unknown> {
    encode(value: V, path: string): SceneJsonValue;

    decode(json: SceneJsonValue, path: string): V;

    defaultValue(): V;
}

export interface FieldTypeDefinition<V = unknown> extends FieldTypeCodec<V> {
    readonly name: string;
}

export type AliasedNumberKind = "number" | "integer";

export interface FieldAlias {
    readonly kind?: AliasedNumberKind;
    readonly options: NumberFieldOptions;
}

export function fieldAlias(options: NumberFieldOptions, kind?: AliasedNumberKind): FieldAlias {
    return kind === undefined ? {options} : {kind, options};
}

export interface FieldTypeResolver {
    customFieldType(name: string): FieldTypeDefinition | undefined;

    assetType(name: string): AssetType | undefined;
}

export interface ComponentSchema<T extends Component = Component> {
    readonly name: string;
    readonly ctor: ComponentCtor<T>;
    readonly persistence: ComponentPersistence;
    readonly fields: readonly FieldSchema[];
    readonly category?: string;
    readonly inferred?: boolean;

    create(): T;
}

export interface ResourceSchema<T extends Resource = Resource> {
    readonly name: string;
    readonly ctor: ResourceCtor<T>;
    readonly fields: readonly FieldSchema[];

    create(): T;
}

export function categoryOf(schema: ComponentSchema): string {
    return schema.category ?? DEFAULT_COMPONENT_CATEGORY;
}

export function isEntityField(field: FieldSchema): field is EntityFieldSchema {
    return field.kind === "entity";
}

export function refersToEntities(type: FieldType): boolean {
    switch (type.kind) {
        case "entity":
            return true;
        case "list":
            return refersToEntities(type.element);
        case "struct":
            return type.fields.some(refersToEntities);
        default:
            return false;
    }
}

export function hasEntityFields(schema: {readonly fields: readonly FieldSchema[]}): boolean {
    return schema.fields.some(refersToEntities);
}
