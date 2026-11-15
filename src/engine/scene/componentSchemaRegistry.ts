import {ComponentType} from "../core/componentType";
import type {Component, ComponentCtor, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {AnyCT} from "../util/tokenUtils";
import type {ComponentSchema, FieldKind, FieldSchema, ResourceSchema} from "./fieldSchema";
import {encodeFieldValue} from "./fieldValueCodec";
import type {FieldEncodeContext} from "./fieldValueCodec";

export const STATIC_SCHEMA_KEY = "schema";

interface FieldHolderSchema {
    readonly name: string;
    readonly ctor: Function;
    readonly fields: readonly FieldSchema[];

    create(): object;
}

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

function validateFieldList(schema: FieldHolderSchema, label: string): void {
    const keys = new Set<string>();
    for (const field of schema.fields) {
        validateFieldShape(field, label);
        if (keys.has(field.key)) throw new Error(`${label}: field "${field.key}" is listed twice`);
        keys.add(field.key);
    }
}

function validateFieldAccess(instance: object, schema: FieldHolderSchema, label: string): void {
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

function validateDefaultValues(instance: object, schema: FieldHolderSchema, label: string): void {
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

function validateCreatedInstance(schema: FieldHolderSchema, label: string): void {
    const instance = schema.create();
    if (!(instance instanceof schema.ctor)) throw new Error(`${label}: create() must return a ${schema.ctor.name}`);
    validateFieldAccess(instance, schema, label);
    validateDefaultValues(instance, schema, label);
}

function validateSchema(schema: ComponentSchema): void {
    if (typeof schema.name !== "string" || schema.name.length === 0) throw new Error("Component schema: the name must be a non-empty string");
    const label = `Component schema "${schema.name}"`;
    if (typeof schema.ctor !== "function") throw new Error(`${label}: ctor must be a component class`);
    if (!isPersistence(schema.persistence)) throw new Error(`${label}: unknown persistence ${JSON.stringify(schema.persistence)}`);
    if (schema.category !== undefined && (typeof schema.category !== "string" || schema.category.length === 0)) {
        throw new Error(`${label}: the category must be a non-empty string`);
    }
    if (schema.persistence !== "fields" && schema.fields.length > 0) {
        throw new Error(`${label} is ${schema.persistence} and must not list fields (${quoted(schema.fields.map(field => field.key))})`);
    }
    validateFieldList(schema, label);
    if (schema.persistence === "implied") return;
    validateCreatedInstance(schema, label);
}

function validateResourceSchema(schema: ResourceSchema): void {
    if (typeof schema.name !== "string" || schema.name.length === 0) throw new Error("Resource schema: the name must be a non-empty string");
    const label = `Resource schema "${schema.name}"`;
    if (typeof schema.ctor !== "function") throw new Error(`${label}: ctor must be a resource class`);
    validateFieldList(schema, label);
    validateCreatedInstance(schema, label);
}

function ownStaticSchema(ctor: Function, kind: string): unknown {
    if (typeof ctor !== "function") throw new Error(`ComponentSchemaRegistry: expected a ${kind} class, got ${typeof ctor}`);
    if (!Object.prototype.hasOwnProperty.call(ctor, STATIC_SCHEMA_KEY)) {
        throw new Error(`ComponentSchemaRegistry: ${ctor.name} declares no static ${STATIC_SCHEMA_KEY} of its own`);
    }
    const schema = (ctor as unknown as Record<string, unknown>)[STATIC_SCHEMA_KEY];
    if (typeof schema !== "object" || schema === null) throw new Error(`ComponentSchemaRegistry: ${ctor.name}.${STATIC_SCHEMA_KEY} is not a built ${kind} schema`);
    const describedCtor = (schema as {readonly ctor?: unknown}).ctor;
    if (describedCtor !== ctor) {
        const describedName = typeof describedCtor === "function" ? describedCtor.name : String(describedCtor);
        throw new Error(`ComponentSchemaRegistry: ${ctor.name}.${STATIC_SCHEMA_KEY} describes ${describedName}, not ${ctor.name}`);
    }
    return schema;
}

export class ComponentSchemaRegistry {
    private readonly _schemas: ComponentSchema[] = [];
    private readonly _byName = new Map<string, ComponentSchema>();
    private readonly _byTypeId = new Map<number, ComponentSchema>();
    private readonly _indexByName = new Map<string, number>();
    private readonly _resourceSchemas: ResourceSchema[] = [];
    private readonly _resourcesByName = new Map<string, ResourceSchema>();
    private readonly _resourcesByCtor = new Map<Function, ResourceSchema>();

    public get schemas(): readonly ComponentSchema[] {
        return this._schemas;
    }

    public get resourceSchemas(): readonly ResourceSchema[] {
        return this._resourceSchemas;
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

    public registerComponentClass<T extends Component>(ctor: ComponentCtor<T>): void {
        this.register(ownStaticSchema(ctor, "component") as ComponentSchema<T>);
    }

    public registerComponentClasses(ctors: readonly ComponentCtor<Component>[]): void {
        for (const ctor of ctors) this.registerComponentClass(ctor);
    }

    public registerResource<T extends Resource>(schema: ResourceSchema<T>): void {
        const general = schema as unknown as ResourceSchema;
        validateResourceSchema(general);
        if (this._resourcesByName.has(general.name)) throw new Error(`ComponentSchemaRegistry: a resource schema named "${general.name}" is already registered`);
        const existing = this._resourcesByCtor.get(general.ctor);
        if (existing !== undefined) {
            throw new Error(`ComponentSchemaRegistry: ${general.ctor.name} is already registered as "${existing.name}", cannot register it again as "${general.name}"`);
        }
        this._resourceSchemas.push(general);
        this._resourcesByName.set(general.name, general);
        this._resourcesByCtor.set(general.ctor, general);
    }

    public registerResourceClass<T extends Resource>(ctor: ResourceCtor<T>): void {
        this.registerResource(ownStaticSchema(ctor, "resource") as ResourceSchema<T>);
    }

    public registerResourceClasses(ctors: readonly ResourceCtor<Resource>[]): void {
        for (const ctor of ctors) this.registerResourceClass(ctor);
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

    public resourceByName(name: string): ResourceSchema | undefined {
        return this._resourcesByName.get(name);
    }

    public resourceByCtor(ctor: ResourceCtor<Resource>): ResourceSchema | undefined {
        return this._resourcesByCtor.get(ctor);
    }
}
