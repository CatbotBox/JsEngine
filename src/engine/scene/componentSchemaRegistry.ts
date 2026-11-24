import {ComponentType} from "../core/componentType";
import type {Component, ComponentCtor, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {AnyCT} from "../util/tokenUtils";
import type {AssetType} from "./assetTypes";
import {dataAssetType} from "./dataAssetDocument";
import {DEFAULT_COMPONENT_CATEGORY, STATIC_SCHEMA_KEY} from "./fieldSchema";
import type {
    ComponentSchema,
    EnumFieldType,
    FieldAlias,
    FieldKind,
    FieldSchema,
    FieldType,
    FieldTypeDefinition,
    FieldTypeResolver,
    IntegerFieldType,
    NumberFieldType,
    ResourceSchema,
} from "./fieldSchema";
import {encodeFieldValue} from "./fieldValueCodec";
import type {FieldEncodeContext} from "./fieldValueCodec";

export {STATIC_SCHEMA_KEY} from "./fieldSchema";

export interface GeneratedComponentOptions {
    readonly category?: string;
}

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
        case "vec2":
        case "vec3":
        case "rotation":
        case "rgb":
        case "textColor":
        case "enum":
        case "entity":
        case "asset":
        case "list":
        case "struct":
        case "custom":
            return true;
        default:
            return false;
    }
}

function isPersistence(persistence: unknown): boolean {
    return persistence === "fields" || persistence === "presenceOnly" || persistence === "implied";
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
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

function listElementPath(path: string): string {
    return `${path}[]`;
}

function validateEnumMembers(type: EnumFieldType, label: string, path: string): void {
    if (type.members.length === 0) throw new Error(`${label}: enum field "${path}" has no members`);
    const names = new Set<string>();
    const values = new Set<string | number>();
    for (const member of type.members) {
        if (names.has(member.name)) throw new Error(`${label}: enum field "${path}" repeats the member name "${member.name}"`);
        if (values.has(member.value)) throw new Error(`${label}: enum field "${path}" repeats the value ${JSON.stringify(member.value)}`);
        names.add(member.name);
        values.add(member.value);
    }
}

function validateTypeShape(type: FieldType, label: string, path: string): void {
    if (!isFieldKind(type.kind)) throw new Error(`${label}: field "${path}" has the unknown kind ${JSON.stringify(type.kind)}`);
    switch (type.kind) {
        case "enum":
            validateEnumMembers(type, label, path);
            return;
        case "asset":
            if (!isNonEmptyString(type.assetType)) throw new Error(`${label}: asset field "${path}" needs a non-empty assetType`);
            return;
        case "custom":
            if (!isNonEmptyString(type.typeName)) throw new Error(`${label}: custom field "${path}" needs a non-empty typeName`);
            return;
        case "list":
            if (typeof type.element !== "object" || type.element === null) throw new Error(`${label}: list field "${path}" needs an element type`);
            validateTypeShape(type.element, label, listElementPath(path));
            return;
        case "struct":
            if (!Array.isArray(type.fields)) throw new Error(`${label}: struct field "${path}" needs a fields array`);
            if (type.create !== undefined && typeof type.create !== "function") throw new Error(`${label}: struct field "${path}" has a create that is not a function`);
            validateFieldShapes(type.fields, label, `${path}.`);
            return;
        default:
            return;
    }
}

function validateFieldShapes(fields: readonly FieldSchema[], label: string, prefix: string): void {
    const keys = new Set<string>();
    for (const field of fields) {
        if (typeof field.key !== "string" || field.key.length === 0) throw new Error(`${label}: every field needs a non-empty key`);
        const path = prefix + field.key;
        validateTypeShape(field, label, path);
        if (keys.has(field.key)) throw new Error(`${label}: field "${path}" is listed twice`);
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

function ownStaticSchema(ctor: Function, kind: string): unknown {
    if (typeof ctor !== "function") throw new Error(`ComponentSchemaRegistry: expected a ${kind} class, got ${typeof ctor}`);
    if (!hasOwnStaticSchema(ctor)) {
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

function hasOwnStaticSchema(ctor: Function): boolean {
    return Object.prototype.hasOwnProperty.call(ctor, STATIC_SCHEMA_KEY);
}

export class ComponentSchemaRegistry implements FieldTypeResolver {
    private readonly _schemas: ComponentSchema[] = [];
    private readonly _byName = new Map<string, ComponentSchema>();
    private readonly _byTypeId = new Map<number, ComponentSchema>();
    private readonly _indexByName = new Map<string, number>();
    private readonly _resourceSchemas: ResourceSchema[] = [];
    private readonly _resourcesByName = new Map<string, ResourceSchema>();
    private readonly _resourcesByCtor = new Map<Function, ResourceSchema>();
    private readonly _fieldAliases = new Map<string, FieldAlias>();
    private readonly _fieldTypes = new Map<string, FieldTypeDefinition>();
    private readonly _assetTypes = new Map<string, AssetType>();
    private readonly _otherBackendTypeNames = new Set<string>();

    public get schemas(): readonly ComponentSchema[] {
        return this._schemas;
    }

    public get resourceSchemas(): readonly ResourceSchema[] {
        return this._resourceSchemas;
    }

    public get assetTypes(): readonly AssetType[] {
        return [...this._assetTypes.values()];
    }

    public register<T extends Component>(schema: ComponentSchema<T>): void {
        const general = this.validatedComponentSchema(schema as unknown as ComponentSchema);
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

    public registerGeneratedComponent<T extends Component>(ctor: ComponentCtor<T>, name: string, fields: readonly FieldSchema[], options: GeneratedComponentOptions = {}): void {
        if (this.hasComponentCtor(ctor)) return;
        if (hasOwnStaticSchema(ctor)) {
            this.registerComponentClass(ctor);
            return;
        }
        this.register<T>({
            name,
            ctor,
            persistence: "fields",
            fields: this.withoutUnregisteredCustomFields(fields, name),
            category: options.category ?? DEFAULT_COMPONENT_CATEGORY,
            inferred: false,
            create: () => new ctor(),
        });
    }

    public hasComponentCtor(ctor: ComponentCtor<Component>): boolean {
        return this._byTypeId.has(ComponentType.of(ctor).id);
    }

    public registerResource<T extends Resource>(schema: ResourceSchema<T>): void {
        const general = this.validatedResourceSchema(schema as unknown as ResourceSchema);
        if (this._resourcesByName.has(general.name)) throw new Error(`ComponentSchemaRegistry: a resource schema named "${general.name}" is already registered`);
        const existing = this._resourcesByCtor.get(general.ctor);
        if (existing !== undefined) {
            throw new Error(`ComponentSchemaRegistry: ${general.ctor.name} is already registered as "${existing.name}", cannot register it again as "${general.name}"`);
        }
        if (this._assetTypes.has(general.name)) throw new Error(`ComponentSchemaRegistry: the resource "${general.name}" would be a data asset type, but an asset type with that name is already registered`);
        this._resourceSchemas.push(general);
        this._resourcesByName.set(general.name, general);
        this._resourcesByCtor.set(general.ctor, general);
        this._assetTypes.set(general.name, dataAssetType(general));
    }

    public registerResourceClass<T extends Resource>(ctor: ResourceCtor<T>): void {
        this.registerResource(ownStaticSchema(ctor, "resource") as ResourceSchema<T>);
    }

    public registerResourceClasses(ctors: readonly ResourceCtor<Resource>[]): void {
        for (const ctor of ctors) this.registerResourceClass(ctor);
    }

    public registerGeneratedResource<T extends Resource>(ctor: ResourceCtor<T>, name: string, fields: readonly FieldSchema[]): void {
        if (this.hasResourceCtor(ctor)) return;
        if (hasOwnStaticSchema(ctor)) {
            this.registerResourceClass(ctor);
            return;
        }
        this.registerResource<T>({name, ctor, fields: this.withoutUnregisteredCustomFields(fields, name), create: () => new ctor()});
    }

    public hasResourceCtor(ctor: ResourceCtor<Resource>): boolean {
        return this._resourcesByCtor.has(ctor);
    }

    public registerFieldAlias(typeName: string, alias: FieldAlias): void {
        if (!isNonEmptyString(typeName)) throw new Error("ComponentSchemaRegistry: a field alias needs a non-empty type name");
        if (alias.kind !== undefined && alias.kind !== "number" && alias.kind !== "integer") {
            throw new Error(`ComponentSchemaRegistry: the field alias "${typeName}" must be a number or integer, not ${JSON.stringify(alias.kind)}`);
        }
        if (typeof alias.options !== "object" || alias.options === null) throw new Error(`ComponentSchemaRegistry: the field alias "${typeName}" needs an options object`);
        if (this._fieldAliases.has(typeName)) throw new Error(`ComponentSchemaRegistry: a field alias named "${typeName}" is already registered`);
        this._fieldAliases.set(typeName, alias);
    }

    public registerFieldType<V>(definition: FieldTypeDefinition<V>): void {
        const name = definition.name;
        if (!isNonEmptyString(name)) throw new Error("ComponentSchemaRegistry: a field type needs a non-empty name");
        const label = `ComponentSchemaRegistry: the field type "${name}"`;
        const isCodec = typeof definition.encode === "function" && typeof definition.decode === "function" && typeof definition.defaultValue === "function";
        if (!isCodec) throw new Error(`${label} needs encode, decode and defaultValue functions`);
        if (this._fieldTypes.has(name)) throw new Error(`${label} is already registered`);
        this._fieldTypes.set(name, definition as FieldTypeDefinition);
    }

    public registerAssetType<A>(type: AssetType<A>): void {
        const name = type.name;
        if (!isNonEmptyString(name)) throw new Error("ComponentSchemaRegistry: an asset type needs a non-empty name");
        const label = `ComponentSchemaRegistry: the asset type "${name}"`;
        const hasSuffixes = Array.isArray(type.fileSuffixes) && type.fileSuffixes.every(isNonEmptyString);
        if (!hasSuffixes) throw new Error(`${label} needs a list of file suffixes`);
        const isLoader = typeof type.isAsset === "function" && typeof type.load === "function" && typeof type.pathOf === "function";
        if (!isLoader) throw new Error(`${label} needs isAsset, load and pathOf functions`);
        const editableStruct = type.inline?.editableStruct;
        if (editableStruct !== undefined && typeof editableStruct !== "function") throw new Error(`${label} has an inline editableStruct that is not a function`);
        if (this._assetTypes.has(name)) throw new Error(`${label} is already registered`);
        this._assetTypes.set(name, type as AssetType);
    }

    public registerOtherBackendTypeNames(names: readonly string[]): void {
        for (const name of names) {
            if (!isNonEmptyString(name)) throw new Error("ComponentSchemaRegistry: another backend's type name must be a non-empty string");
            this._otherBackendTypeNames.add(name);
        }
    }

    public isOtherBackendTypeName(name: string): boolean {
        return this._otherBackendTypeNames.has(name);
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

    public fieldAlias(typeName: string): FieldAlias | undefined {
        return this._fieldAliases.get(typeName);
    }

    public customFieldType(name: string): FieldTypeDefinition | undefined {
        return this._fieldTypes.get(name);
    }

    public assetType(name: string): AssetType | undefined {
        return this._assetTypes.get(name);
    }

    private withoutUnregisteredCustomFields(fields: readonly FieldSchema[], ownerPath: string): readonly FieldSchema[] {
        let changed = false;
        const kept: FieldSchema[] = [];
        for (const field of fields) {
            const type = this.withoutUnregisteredCustomTypes(field, `${ownerPath}.${field.key}`);
            if (type === field) {
                kept.push(field);
                continue;
            }
            changed = true;
            if (type !== undefined) kept.push({key: field.key, ...type} as FieldSchema);
        }
        return changed ? kept : fields;
    }

    private withoutUnregisteredCustomTypes(type: FieldType, path: string): FieldType | undefined {
        switch (type.kind) {
            case "custom":
                if (this._fieldTypes.has(type.typeName)) return type;
                console.warn(`ComponentSchemaRegistry: left out the generated field ${path}: its custom field type "${type.typeName}" is not registered (registerFieldType)`);
                return undefined;
            case "list": {
                const hasElement = typeof type.element === "object" && type.element !== null;
                if (!hasElement) return type;
                const element = this.withoutUnregisteredCustomTypes(type.element, listElementPath(path));
                if (element === undefined) return undefined;
                return element === type.element ? type : {...type, element};
            }
            case "struct": {
                const isRegisteredFieldType = type.typeName !== undefined && this._fieldTypes.has(type.typeName);
                if (isRegisteredFieldType || !Array.isArray(type.fields)) return type;
                const fields = this.withoutUnregisteredCustomFields(type.fields, path);
                return fields === type.fields ? type : {...type, fields};
            }
            default:
                return type;
        }
    }

    private validatedComponentSchema(schema: ComponentSchema): ComponentSchema {
        if (!isNonEmptyString(schema.name)) throw new Error("Component schema: the name must be a non-empty string");
        const label = `Component schema "${schema.name}"`;
        if (typeof schema.ctor !== "function") throw new Error(`${label}: ctor must be a component class`);
        if (!isPersistence(schema.persistence)) throw new Error(`${label}: unknown persistence ${JSON.stringify(schema.persistence)}`);
        if (schema.category !== undefined && !isNonEmptyString(schema.category)) {
            throw new Error(`${label}: the category must be a non-empty string`);
        }
        if (schema.persistence !== "fields" && schema.fields.length > 0) {
            throw new Error(`${label} is ${schema.persistence} and must not list fields (${quoted(schema.fields.map(field => field.key))})`);
        }
        validateFieldShapes(schema.fields, label, "");
        const resolved = this.withResolvedFields(schema, label);
        if (resolved.persistence !== "implied") this.validateCreatedInstance(resolved, label);
        return resolved;
    }

    private validatedResourceSchema(schema: ResourceSchema): ResourceSchema {
        if (!isNonEmptyString(schema.name)) throw new Error("Resource schema: the name must be a non-empty string");
        const label = `Resource schema "${schema.name}"`;
        if (typeof schema.ctor !== "function") throw new Error(`${label}: ctor must be a resource class`);
        if (schema.category !== undefined && !isNonEmptyString(schema.category)) {
            throw new Error(`${label}: the category must be a non-empty string`);
        }
        validateFieldShapes(schema.fields, label, "");
        const resolved = this.withResolvedFields(schema, label);
        this.validateCreatedInstance(resolved, label);
        return resolved;
    }

    private withResolvedFields<S extends {readonly fields: readonly FieldSchema[]}>(schema: S, label: string): S {
        const fields = this.resolveFields(schema.fields, label, "");
        return fields === schema.fields ? schema : Object.freeze({...schema, fields});
    }

    private resolveFields(fields: readonly FieldSchema[], label: string, prefix: string): readonly FieldSchema[] {
        let changed = false;
        const resolved = fields.map(field => {
            const type = this.resolveType(field, label, prefix + field.key);
            if (type === field) return field;
            changed = true;
            return {key: field.key, ...type} as FieldSchema;
        });
        return changed ? Object.freeze(resolved) : fields;
    }

    private resolveType(type: FieldType, label: string, path: string): FieldType {
        switch (type.kind) {
            case "number":
            case "integer":
                return this.withAlias(type);
            case "struct": {
                if (type.typeName !== undefined && this._fieldTypes.has(type.typeName)) return {kind: "custom", typeName: type.typeName};
                const fields = this.resolveFields(type.fields, label, `${path}.`);
                return fields === type.fields ? type : {...type, fields};
            }
            case "custom":
                if (!this._fieldTypes.has(type.typeName)) {
                    throw new Error(`${label}: field "${path}" uses the custom field type "${type.typeName}", which is not registered (registerFieldType)`);
                }
                return type;
            case "list": {
                const element = this.resolveType(type.element, label, listElementPath(path));
                return element === type.element ? type : {kind: "list", element};
            }
            default:
                return type;
        }
    }

    private withAlias(type: NumberFieldType | IntegerFieldType): FieldType {
        const typeName = type.typeName;
        const alias = typeName === undefined ? undefined : this._fieldAliases.get(typeName);
        if (alias === undefined) return type;
        const options = {...alias.options, ...type.options};
        const nullable = type.nullable === true ? {nullable: true} : {};
        if ((alias.kind ?? type.kind) === "integer") return {kind: "integer", ...nullable, typeName, options};
        const uncapped = type.kind === "number" && type.uncapped === true ? {uncapped: true} : {};
        return {kind: "number", ...nullable, ...uncapped, typeName, options};
    }

    private validateCreatedInstance(schema: FieldHolderSchema, label: string): void {
        const instance = schema.create();
        if (!(instance instanceof schema.ctor)) throw new Error(`${label}: create() must return a ${schema.ctor.name}`);
        validateFieldAccess(instance, schema, label);
        this.validateDefaultValues(instance, schema, label);
    }

    private validateDefaultValues(instance: object, schema: FieldHolderSchema, label: string): void {
        const context: FieldEncodeContext = {
            sceneIdOf: () => undefined,
            reportDanglingEntity: () => undefined,
            reportUnsavedAsset: () => undefined,
            fieldTypes: this,
        };
        const values = instance as Record<string, unknown>;
        for (const field of schema.fields) {
            try {
                encodeFieldValue(field, values[field.key], context, `${schema.name}.${field.key}`);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new Error(`${label}: the created value of field "${field.key}" does not fit kind "${field.kind}": ${reason}`);
            }
        }
    }
}
