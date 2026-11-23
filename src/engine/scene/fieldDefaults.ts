import {NULL_ENTITY} from "../core/entity";
import {Vec2, Vec3, Vec4} from "../math/types/vec";
import {PACKED_RGB_MASK} from "../rendering/packedRgb";
import {TextColor} from "../rendering/textColor";
import type {FieldType, FieldTypeDefinition, FieldTypeResolver, StructFieldType} from "./fieldSchema";

const DEFAULT_NUMBER = 0;
const DEFAULT_RGB = PACKED_RGB_MASK;
const IDENTITY_QUATERNION_W = 1;

export function customFieldTypeOf(fieldTypes: FieldTypeResolver | undefined, typeName: string, path: string): FieldTypeDefinition {
    const definition = fieldTypes?.customFieldType(typeName);
    if (definition === undefined) throw new Error(`Scene field ${path}: the custom field type "${typeName}" is not registered`);
    return definition;
}

export function createStructValue(type: StructFieldType, fieldTypes?: FieldTypeResolver, path: string = type.typeName ?? "struct"): object {
    if (type.create !== undefined) return type.create();
    const value: Record<string, unknown> = {};
    for (const field of type.fields) value[field.key] = defaultFieldValue(field, fieldTypes, `${path}.${field.key}`);
    return value;
}

export function defaultFieldValue(type: FieldType, fieldTypes?: FieldTypeResolver, path: string = type.kind): unknown {
    switch (type.kind) {
        case "number":
        case "integer":
            return type.nullable === true ? undefined : DEFAULT_NUMBER;
        case "boolean":
            return false;
        case "string":
            return type.nullable ? undefined : "";
        case "textLines":
            return [];
        case "vec2":
            return Vec2.alloc();
        case "vec3":
            return Vec3.alloc();
        case "rotation":
            return Vec4.alloc(0, 0, 0, IDENTITY_QUATERNION_W);
        case "rgb":
            return DEFAULT_RGB;
        case "textColor":
            return TextColor.DEFAULT;
        case "enum":
            return type.members[0]?.value;
        case "entity":
            return NULL_ENTITY;
        case "asset":
            return undefined;
        case "list":
            return [];
        case "struct":
            return type.nullable === true ? undefined : createStructValue(type, fieldTypes, path);
        case "custom":
            return customFieldTypeOf(fieldTypes, type.typeName, path).defaultValue();
    }
}
