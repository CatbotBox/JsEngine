import type {Component, ComponentCtor, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";

export const DEFAULT_COMPONENT_CATEGORY = "Game";

export type FieldKind =
    | "number"
    | "integer"
    | "boolean"
    | "string"
    | "textLines"
    | "vec3"
    | "rotation"
    | "rgb"
    | "textColor"
    | "enum"
    | "entity"
    | "mesh"
    | "spriteImage";

export type PlainFieldKind = Exclude<FieldKind, "string" | "enum" | "entity">;

export type ComponentPersistence = "fields" | "presenceOnly" | "implied";

export type EnumValue = string | number;

export interface EnumMember {
    readonly name: string;
    readonly value: EnumValue;
}

export interface PlainFieldSchema {
    readonly key: string;
    readonly kind: PlainFieldKind;
}

export interface StringFieldSchema {
    readonly key: string;
    readonly kind: "string";
    readonly nullable: boolean;
}

export interface EntityFieldSchema {
    readonly key: string;
    readonly kind: "entity";
    readonly nullable: boolean;
}

export interface EnumFieldSchema {
    readonly key: string;
    readonly kind: "enum";
    readonly members: readonly EnumMember[];
}

export type FieldSchema = PlainFieldSchema | StringFieldSchema | EntityFieldSchema | EnumFieldSchema;

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

export function hasEntityFields(schema: ComponentSchema): boolean {
    return schema.fields.some(isEntityField);
}
