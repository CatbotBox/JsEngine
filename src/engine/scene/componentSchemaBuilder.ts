import type {Component, ComponentCtor, Entity, Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {Vec2, Vec3, Vec4} from "../math/types/vec";
import type {TextColor} from "../rendering/textColor";
import type {Mesh} from "../rendering/3d/mesh";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import {DEFAULT_COMPONENT_CATEGORY, MESH_ASSET_TYPE_NAME, PREFAB_ASSET_TYPE_NAME, SPRITE_IMAGE_ASSET_TYPE_NAME, STATIC_SCHEMA_KEY} from "./fieldSchema";
import type {
    ComponentPersistence,
    ComponentSchema,
    EnumMember,
    EnumValue,
    FieldSchema,
    FieldType,
    IntegerFieldType,
    NumberFieldOptions,
    NumberFieldType,
    PlainFieldKind,
    ResourceSchema,
    StructFieldType,
} from "./fieldSchema";
import type {PrefabAsset} from "./prefabAsset";

type SameModifiers<X, Y> = (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? true : false;

export type KeysOfType<T, V> = {
    [K in keyof T]-?: [T[K]] extends [V] ? ([V] extends [T[K]] ? K : never) : never
}[keyof T];

// A key is writable when its one-key slice is identical to the same slice with readonly stripped; SameModifiers sees modifiers that extends ignores.
export type WritableKeys<T> = {
    [K in keyof T]-?: SameModifiers<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }> extends true ? K : never
}[keyof T];

export type FieldKey<T, V> = KeysOfType<T, V> & WritableKeys<T> & string;

export type VectorKey<T, V> = KeysOfType<T, V> & string;

export type ListKey<T> = {
    [K in keyof T]-?: T[K] extends readonly unknown[] ? K : never
}[keyof T] & WritableKeys<T> & string;

export type StructKey<T> = {
    [K in keyof T]-?: T[K] extends object ? K : never
}[keyof T] & WritableKeys<T> & string;

export type NullableStructKey<T> = {
    [K in keyof T]-?: undefined extends T[K] ? (Exclude<T[K], undefined> extends object ? K : never) : never
}[keyof T] & WritableKeys<T> & string;

export interface EntityFieldOptions {
    readonly nullable: boolean;
}

export interface NumberFieldBuildOptions extends NumberFieldOptions {
    readonly uncapped?: boolean;
    readonly typeName?: string;
}

export interface IntegerFieldBuildOptions extends NumberFieldOptions {
    readonly typeName?: string;
}

export interface StructFieldBuildOptions {
    readonly typeName?: string;
    readonly create?: () => object;
}

const NULLABLE_ENTITY_FIELD: EntityFieldOptions = {nullable: true};
const NO_NUMBER_OPTIONS: NumberFieldBuildOptions = {};
const NO_INTEGER_OPTIONS: IntegerFieldBuildOptions = {};
const NO_STRUCT_OPTIONS: StructFieldBuildOptions = {};
const NULLABLE = true;
const NOT_NULLABLE = false;

function hasNumberOptions(options: NumberFieldOptions): boolean {
    return Object.keys(options).length > 0;
}

function numberFieldType(nullable: boolean, {uncapped, typeName, ...options}: NumberFieldBuildOptions): NumberFieldType {
    return {
        kind: "number",
        ...(nullable ? {nullable} : {}),
        ...(uncapped === true ? {uncapped} : {}),
        ...(typeName === undefined ? {} : {typeName}),
        ...(hasNumberOptions(options) ? {options} : {}),
    };
}

function integerFieldType(nullable: boolean, {typeName, ...options}: IntegerFieldBuildOptions): IntegerFieldType {
    return {
        kind: "integer",
        ...(nullable ? {nullable} : {}),
        ...(typeName === undefined ? {} : {typeName}),
        ...(hasNumberOptions(options) ? {options} : {}),
    };
}

function structFieldType(nullable: boolean, fields: readonly FieldSchema[], {typeName, create}: StructFieldBuildOptions): StructFieldType {
    return {
        kind: "struct",
        ...(nullable ? {nullable} : {}),
        ...(typeName === undefined ? {} : {typeName}),
        fields: Object.freeze([...fields]),
        ...(create === undefined ? {} : {create}),
    };
}

function dataAssetTypeNameOf(type: ResourceCtor<Resource>): string {
    if (!Object.prototype.hasOwnProperty.call(type, STATIC_SCHEMA_KEY)) return type.name;
    const schema = (type as unknown as Record<string, unknown>)[STATIC_SCHEMA_KEY] as {readonly name?: unknown} | undefined;
    return typeof schema?.name === "string" ? schema.name : type.name;
}

export abstract class FieldListBuilder<T extends object> {
    protected readonly _fields: FieldSchema[] = [];

    public number(key: FieldKey<T, number>, options: NumberFieldBuildOptions = NO_NUMBER_OPTIONS): this {
        return this.field(key, numberFieldType(NOT_NULLABLE, options));
    }

    public nullableNumber(key: FieldKey<T, number | undefined>, options: NumberFieldBuildOptions = NO_NUMBER_OPTIONS): this {
        return this.field(key, numberFieldType(NULLABLE, options));
    }

    public integer(key: FieldKey<T, number>, options: IntegerFieldBuildOptions = NO_INTEGER_OPTIONS): this {
        return this.field(key, integerFieldType(NOT_NULLABLE, options));
    }

    public nullableInteger(key: FieldKey<T, number | undefined>, options: IntegerFieldBuildOptions = NO_INTEGER_OPTIONS): this {
        return this.field(key, integerFieldType(NULLABLE, options));
    }

    public boolean(key: FieldKey<T, boolean>): this {
        return this.plain(key, "boolean");
    }

    public string(key: FieldKey<T, string>): this {
        return this.field(key, {kind: "string", nullable: NOT_NULLABLE});
    }

    public nullableString(key: FieldKey<T, string | undefined>): this {
        return this.field(key, {kind: "string", nullable: NULLABLE});
    }

    public textLines(key: FieldKey<T, string[]>): this {
        return this.plain(key, "textLines");
    }

    public vec2(key: VectorKey<T, Vec2>): this {
        return this.plain(key, "vec2");
    }

    public vec3(key: VectorKey<T, Vec3>): this {
        return this.plain(key, "vec3");
    }

    public rotation(key: VectorKey<T, Vec4>): this {
        return this.plain(key, "rotation");
    }

    public rgb(key: FieldKey<T, number>): this {
        return this.plain(key, "rgb");
    }

    public textColor(key: FieldKey<T, TextColor>): this {
        return this.plain(key, "textColor");
    }

    public enum<V extends EnumValue>(key: FieldKey<T, V>, members: Readonly<Record<string, V>>): this {
        const enumMembers: EnumMember[] = Object.keys(members).map(name => ({name, value: members[name]}));
        return this.field(key, {kind: "enum", members: enumMembers});
    }

    public entity(key: FieldKey<T, Entity>, options: EntityFieldOptions = NULLABLE_ENTITY_FIELD): this {
        return this.field(key, {kind: "entity", nullable: options.nullable});
    }

    public list(key: ListKey<T>, element: FieldType): this {
        return this.field(key, {kind: "list", element});
    }

    public struct(key: StructKey<T>, fields: readonly FieldSchema[], options: StructFieldBuildOptions = NO_STRUCT_OPTIONS): this {
        return this.field(key, structFieldType(NOT_NULLABLE, fields, options));
    }

    public nullableStruct(key: NullableStructKey<T>, fields: readonly FieldSchema[], options: StructFieldBuildOptions = NO_STRUCT_OPTIONS): this {
        return this.field(key, structFieldType(NULLABLE, fields, options));
    }

    public asset(key: WritableKeys<T> & string, assetType: string): this {
        return this.field(key, {kind: "asset", assetType});
    }

    public mesh(key: FieldKey<T, Mesh | undefined>): this {
        return this.asset(key, MESH_ASSET_TYPE_NAME);
    }

    public spriteImage(key: FieldKey<T, SpriteImage | undefined>): this {
        return this.asset(key, SPRITE_IMAGE_ASSET_TYPE_NAME);
    }

    public prefab(key: FieldKey<T, PrefabAsset | undefined>): this {
        return this.asset(key, PREFAB_ASSET_TYPE_NAME);
    }

    public dataAsset<R extends Resource>(key: FieldKey<T, R | undefined>, type: ResourceCtor<R>, typeName: string = dataAssetTypeNameOf(type)): this {
        return this.asset(key, typeName);
    }

    private plain(key: string, kind: PlainFieldKind): this {
        return this.field(key, {kind});
    }

    private field(key: string, type: FieldType): this {
        this._fields.push({key, ...type} as FieldSchema);
        return this;
    }
}

export class StructFieldsBuilder<T extends object> extends FieldListBuilder<T> {
    public build(): readonly FieldSchema[] {
        return Object.freeze([...this._fields]);
    }
}

export class ComponentSchemaBuilder<T extends Component> extends FieldListBuilder<T> {
    private _persistence: ComponentPersistence = "fields";
    private _category: string = DEFAULT_COMPONENT_CATEGORY;
    private _create: () => T;

    public constructor(private readonly _ctor: ComponentCtor<T>, private readonly _name: string) {
        super();
        this._create = () => new _ctor();
    }

    public presenceOnly(): this {
        this._persistence = "presenceOnly";
        return this;
    }

    public implied(): this {
        this._persistence = "implied";
        return this;
    }

    public category(category: string): this {
        this._category = category;
        return this;
    }

    public create(factory: () => T): this {
        this._create = factory;
        return this;
    }

    public build(): ComponentSchema<T> {
        return Object.freeze({
            name: this._name,
            ctor: this._ctor,
            persistence: this._persistence,
            fields: Object.freeze([...this._fields]),
            category: this._category,
            inferred: false,
            create: this._create,
        });
    }
}

export class ResourceSchemaBuilder<T extends Resource> extends FieldListBuilder<T> {
    private _category: string | undefined;
    private _create: () => T;

    public constructor(private readonly _ctor: ResourceCtor<T>, private readonly _name: string) {
        super();
        this._create = () => new _ctor();
    }

    public category(category: string): this {
        this._category = category;
        return this;
    }

    public create(factory: () => T): this {
        this._create = factory;
        return this;
    }

    public build(): ResourceSchema<T> {
        return Object.freeze({
            name: this._name,
            ctor: this._ctor,
            fields: Object.freeze([...this._fields]),
            ...(this._category === undefined ? {} : {category: this._category}),
            create: this._create,
        });
    }
}

export function componentSchema<T extends Component>(ctor: ComponentCtor<T>, name: string): ComponentSchemaBuilder<T> {
    return new ComponentSchemaBuilder(ctor, name);
}

export function resourceSchema<T extends Resource>(ctor: ResourceCtor<T>, name: string): ResourceSchemaBuilder<T> {
    return new ResourceSchemaBuilder(ctor, name);
}

export function structFields<T extends object>(): StructFieldsBuilder<T> {
    return new StructFieldsBuilder<T>();
}
