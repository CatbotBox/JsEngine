import type {Component, ComponentCtor, Entity} from "../core";
import type {Vec3, Vec4} from "../math/types/vec";
import type {TextColor} from "../rendering/textColor";
import type {Mesh} from "../rendering/3d/mesh";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import type {ComponentPersistence, ComponentSchema, EnumMember, EnumValue, FieldSchema, PlainFieldKind} from "./fieldSchema";

type SameModifiers<X, Y> = (<G>() => G extends X ? 1 : 2) extends (<G>() => G extends Y ? 1 : 2) ? true : false;

export type KeysOfType<T, V> = {
    [K in keyof T]-?: [T[K]] extends [V] ? ([V] extends [T[K]] ? K : never) : never
}[keyof T];

export type WritableKeys<T> = {
    [K in keyof T]-?: SameModifiers<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }> extends true ? K : never
}[keyof T];

export type FieldKey<T, V> = KeysOfType<T, V> & WritableKeys<T> & string;

export interface EntityFieldOptions {
    readonly nullable: boolean;
}

const NULLABLE_ENTITY_FIELD: EntityFieldOptions = {nullable: true};

export class ComponentSchemaBuilder<T extends Component> {
    private readonly _fields: FieldSchema[] = [];
    private _persistence: ComponentPersistence = "fields";
    private _create: () => T;

    public constructor(private readonly _ctor: ComponentCtor<T>, private readonly _name: string) {
        this._create = () => new _ctor();
    }

    public number(key: FieldKey<T, number>): this {
        return this.plain(key, "number");
    }

    public integer(key: FieldKey<T, number>): this {
        return this.plain(key, "integer");
    }

    public boolean(key: FieldKey<T, boolean>): this {
        return this.plain(key, "boolean");
    }

    public string(key: FieldKey<T, string>): this {
        this._fields.push({key, kind: "string", nullable: false});
        return this;
    }

    public nullableString(key: FieldKey<T, string | undefined>): this {
        this._fields.push({key, kind: "string", nullable: true});
        return this;
    }

    public textLines(key: FieldKey<T, string[]>): this {
        return this.plain(key, "textLines");
    }

    public vec3(key: FieldKey<T, Vec3>): this {
        return this.plain(key, "vec3");
    }

    public rotation(key: FieldKey<T, Vec4>): this {
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
        this._fields.push({key, kind: "enum", members: enumMembers});
        return this;
    }

    public entity(key: FieldKey<T, Entity>, options: EntityFieldOptions = NULLABLE_ENTITY_FIELD): this {
        this._fields.push({key, kind: "entity", nullable: options.nullable});
        return this;
    }

    public mesh(key: FieldKey<T, Mesh | undefined>): this {
        return this.plain(key, "mesh");
    }

    public spriteImage(key: FieldKey<T, SpriteImage | undefined>): this {
        return this.plain(key, "spriteImage");
    }

    public presenceOnly(): this {
        this._persistence = "presenceOnly";
        return this;
    }

    public implied(): this {
        this._persistence = "implied";
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
            create: this._create,
        });
    }

    private plain(key: string, kind: PlainFieldKind): this {
        this._fields.push({key, kind});
        return this;
    }
}

export function componentSchema<T extends Component>(ctor: ComponentCtor<T>, name: string): ComponentSchemaBuilder<T> {
    return new ComponentSchemaBuilder(ctor, name);
}
