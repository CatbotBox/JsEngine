import type {Component, ComponentCtor} from "../core";
import {DEFAULT_COMPONENT_CATEGORY} from "./fieldSchema";
import type {ComponentSchema, FieldSchema} from "./fieldSchema";

const VEC3_LENGTH = 3;
const QUATERNION_LENGTH = 4;

function isNumberVector(value: unknown, length: number): boolean {
    if (value instanceof Float32Array) return value.length === length;
    return Array.isArray(value) && value.length === length && value.every(element => typeof element === "number");
}

function inferredField(key: string, value: unknown): FieldSchema | undefined {
    if (typeof value === "number") return {key, kind: "number"};
    if (typeof value === "boolean") return {key, kind: "boolean"};
    if (typeof value === "string") return {key, kind: "string", nullable: false};
    if (isNumberVector(value, VEC3_LENGTH)) return {key, kind: "vec3"};
    if (isNumberVector(value, QUATERNION_LENGTH)) return {key, kind: "rotation"};
    return undefined;
}

export function inferComponentSchema<T extends Component>(instance: T): ComponentSchema<T> {
    const ctor = instance.constructor as ComponentCtor<T>;
    const values = instance as unknown as Record<string, unknown>;
    const fields: FieldSchema[] = [];
    for (const key of Object.keys(instance)) {
        const field = inferredField(key, values[key]);
        if (field !== undefined) fields.push(field);
    }
    return Object.freeze({
        name: ctor.name,
        ctor,
        persistence: "fields",
        fields: Object.freeze(fields),
        category: DEFAULT_COMPONENT_CATEGORY,
        inferred: true,
        create: () => new ctor(),
    });
}
