import {ComponentType} from "../core/componentType";
import type {Component} from "../core";
import type {AnyCT} from "../util/tokenUtils";
import type {ComponentSchema, FieldKind, FieldSchema} from "./fieldSchema";
import {encodeFieldValue} from "./fieldValueCodec";
import type {FieldEncodeContext} from "./fieldValueCodec";

function isFieldKind(kind: unknown): kind is FieldKind {
    switch (kind) {
        case "number":
        case "integer":
        case "boolean":
        case "string":
        case "textLines":
        case "vec3":
        case "rotation":
        case "rgb":
        case "textColor":
        case "enum":
        case "entity":
        case "mesh":
        case "spriteImage":
            return true;
        default:
            return false;
    }
}

function isPersistence(persistence: unknown): boolean {
    return persistence === "fields" || persistence === "presenceOnly" || persistence === "implied";
}

function findPropertyDescriptor(target: object, key: string): PropertyDescriptor | undefined {
    for (let owner: object | null = target; owner !== null; owner = Object.getPrototypeOf(owner) as object | null) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor !== undefined) return descriptor;
    }
    return undefined;
}

function quoted(keys: readonly string[]): string {
    return keys.map(key => JSON.stringify(key)).join(", ");
}

const DEFAULT_VALUE_CHECK: FieldEncodeContext = {
    sceneIdOf: () => undefined,
    reportDanglingEntity: () => undefined,
    reportUnsavedAsset: () => undefined,
};

function validateFieldShape(field: FieldSchema, label: string): void {
    if (typeof field.key !== "string" || field.key.length === 0) throw new Error(`${label}: every field needs a non-empty key`);
    if (!isFieldKind(field.kind)) throw new Error(`${label}: field "${field.key}" has the unknown kind ${JSON.stringify(field.kind)}`);
    if (field.kind !== "enum") return;
    if (field.members.length === 0) throw new Error(`${label}: enum field "${field.key}" has no members`);
    const names = new Set<string>();
    const values = new Set<string | number>();
    for (const member of field.members) {
        if (names.has(member.name)) throw new Error(`${label}: enum field "${field.key}" repeats the member name "${member.name}"`);
        if (values.has(member.value)) throw new Error(`${label}: enum field "${field.key}" repeats the value ${JSON.stringify(member.value)}`);
        names.add(member.name);
        values.add(member.value);
    }
}

function validateFieldAccess(instance: object, schema: ComponentSchema, label: string): void {
    const unknownKeys: string[] = [];
    for (const field of schema.fields) {
        const descriptor = findPropertyDescriptor(instance, field.key);
        if (descriptor === undefined) {
            unknownKeys.push(field.key);
            continue;
        }
        const isAccessor = descriptor.get !== undefined || descriptor.set !== undefined;
        if (isAccessor && descriptor.get === undefined) throw new Error(`${label}: field "${field.key}" has a setter but no getter`);
        if (isAccessor && descriptor.set === undefined) throw new Error(`${label}: field "${field.key}" has a getter but no setter`);
        if (!isAccessor && descriptor.writable !== true) throw new Error(`${label}: field "${field.key}" is read-only`);
    }
    if (unknownKeys.length > 0) {
        throw new Error(`${label}: unknown field${unknownKeys.length === 1 ? "" : "s"} ${quoted(unknownKeys)} (not properties of a created ${schema.ctor.name})`);
    }
}

function validateDefaultValues(instance: object, schema: ComponentSchema, label: string): void {
    const values = instance as Record<string, unknown>;
    for (const field of schema.fields) {
        try {
            encodeFieldValue(field, values[field.key], DEFAULT_VALUE_CHECK, `${schema.name}.${field.key}`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`${label}: the created value of field "${field.key}" does not fit kind "${field.kind}": ${reason}`);
        }
    }
}

function validateSchema(schema: ComponentSchema): void {
    if (typeof schema.name !== "string" || schema.name.length === 0) throw new Error("Component schema: the name must be a non-empty string");
    const label = `Component schema "${schema.name}"`;
    if (typeof schema.ctor !== "function") throw new Error(`${label}: ctor must be a component class`);
    if (!isPersistence(schema.persistence)) throw new Error(`${label}: unknown persistence ${JSON.stringify(schema.persistence)}`);
    if (schema.persistence !== "fields" && schema.fields.length > 0) {
        throw new Error(`${label} is ${schema.persistence} and must not list fields (${quoted(schema.fields.map(field => field.key))})`);
    }
    const keys = new Set<string>();
    for (const field of schema.fields) {
        validateFieldShape(field, label);
        if (keys.has(field.key)) throw new Error(`${label}: field "${field.key}" is listed twice`);
        keys.add(field.key);
    }
    if (schema.persistence === "implied") return;
    const instance: Component = schema.create();
    if (!(instance instanceof schema.ctor)) throw new Error(`${label}: create() must return a ${schema.ctor.name}`);
    validateFieldAccess(instance, schema, label);
    validateDefaultValues(instance, schema, label);
}

export class ComponentSchemaRegistry {
    private readonly _schemas: ComponentSchema[] = [];
    private readonly _byName = new Map<string, ComponentSchema>();
    private readonly _byTypeId = new Map<number, ComponentSchema>();
    private readonly _indexByName = new Map<string, number>();

    public get schemas(): readonly ComponentSchema[] {
        return this._schemas;
    }

    public register<T extends Component>(schema: ComponentSchema<T>): void {
        const general = schema as unknown as ComponentSchema;
        validateSchema(general);
        if (this._byName.has(general.name)) throw new Error(`ComponentSchemaRegistry: a schema named "${general.name}" is already registered`);
        const typeId = ComponentType.of(general.ctor).id;
        const existing = this._byTypeId.get(typeId);
        if (existing !== undefined) {
            throw new Error(`ComponentSchemaRegistry: ${general.ctor.name} is already registered as "${existing.name}", cannot register it again as "${general.name}"`);
        }
        this._indexByName.set(general.name, this._schemas.length);
        this._schemas.push(general);
        this._byName.set(general.name, general);
        this._byTypeId.set(typeId, general);
    }

    public byName(name: string): ComponentSchema | undefined {
        return this._byName.get(name);
    }

    public byType(type: AnyCT): ComponentSchema | undefined {
        return this._byTypeId.get(type.id);
    }

    public indexOf(schema: ComponentSchema): number {
        const index = this._indexByName.get(schema.name);
        if (index === undefined || this._schemas[index] !== schema) throw new Error(`ComponentSchemaRegistry: "${schema.name}" is not registered here`);
        return index;
    }
}
