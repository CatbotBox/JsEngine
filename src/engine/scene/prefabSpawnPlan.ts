import type {Component, ComponentCtor, Entity} from "../core";
import {NULL_ENTITY} from "../core/entity";
import {asFloat32Array, fromFloat32Array} from "../math/types/vec";
import type {ReadonlyVec} from "../math/types/vec";
import {createStructValue} from "./fieldDefaults";
import {isEntityField} from "./fieldSchema";
import type {ComponentSchema, FieldSchema, FieldType, StructFieldType} from "./fieldSchema";
import {copiesVectorInPlace, decodeFieldValue, isNumberSlots, readSceneEntityId} from "./fieldValueCodec";
import type {FieldDecodeContext, NumberSlots} from "./fieldValueCodec";
import type {SceneJsonObject, SceneJsonValue} from "./sceneDocument";

export const NO_SPAWNED_ENTITIES: readonly Entity[] = [];

const NO_ENTITY_INDEX = -1;

type FieldValues = Record<string, unknown>;

type FieldSetter = (value: unknown) => void;

type FieldGetter = () => unknown;

export interface PrefabFieldScope {
    readonly context: FieldDecodeContext;

    entityIndexOf(sceneId: number): number | undefined;
}

export interface AuthoredField {
    readonly field: FieldSchema;
    readonly json: SceneJsonValue;
    readonly decoded: unknown;
    readonly path: string;
}

interface FieldValueSource {
    valueFor(entities: readonly Entity[]): unknown;
}

interface FieldWrite {
    write(component: Component, entities: readonly Entity[]): void;
}

interface StructMemberValue {
    readonly key: string;
    readonly source: FieldValueSource;
}

function fieldsOf(target: object): FieldValues {
    return target as FieldValues;
}

class SharedFieldValue implements FieldValueSource {
    public constructor(public readonly value: unknown) {
    }

    public valueFor(): unknown {
        return this.value;
    }
}

class VectorFieldValue implements FieldValueSource {
    private readonly components: Float32Array;

    public constructor(vector: ReadonlyVec<number>) {
        this.components = asFloat32Array(vector);
    }

    public valueFor(): unknown {
        const copy = new Float32Array(this.components.length);
        this.copyInto(copy);
        return fromFloat32Array(copy);
    }

    public fits(target: NumberSlots): boolean {
        return target.length === this.components.length;
    }

    public copyInto(target: NumberSlots): void {
        const components = this.components;
        for (let i = 0; i < components.length; i++) target[i] = components[i];
    }
}

class TextLinesFieldValue implements FieldValueSource {
    public constructor(private readonly lines: readonly string[]) {
    }

    public valueFor(): unknown {
        return this.lines.slice();
    }
}

class ListFieldValue implements FieldValueSource {
    public constructor(private readonly elements: readonly FieldValueSource[]) {
    }

    public valueFor(entities: readonly Entity[]): unknown {
        const elements = this.elements;
        const list: unknown[] = [];
        for (let i = 0; i < elements.length; i++) list.push(elements[i].valueFor(entities));
        return list;
    }
}

class StructFieldValue implements FieldValueSource {
    public constructor(
        private readonly type: StructFieldType,
        private readonly members: readonly StructMemberValue[],
        private readonly context: FieldDecodeContext,
        private readonly path: string,
    ) {
    }

    public valueFor(entities: readonly Entity[]): unknown {
        const target = fieldsOf(createStructValue(this.type, this.context.fieldTypes, this.path));
        const members = this.members;
        for (let i = 0; i < members.length; i++) target[members[i].key] = members[i].source.valueFor(entities);
        return target;
    }
}

class EntityFieldValue implements FieldValueSource {
    public constructor(private readonly index: number) {
    }

    public valueFor(entities: readonly Entity[]): unknown {
        return this.index === NO_ENTITY_INDEX ? NULL_ENTITY : entities[this.index];
    }
}

class DecodedFieldValue implements FieldValueSource {
    public constructor(
        private readonly type: FieldType,
        private readonly json: SceneJsonValue,
        private readonly context: FieldDecodeContext,
        private readonly path: string,
    ) {
    }

    public valueFor(): unknown {
        return decodeFieldValue(this.type, this.json, this.context, this.path);
    }
}

class PropertyWrite implements FieldWrite {
    public constructor(private readonly key: string, private readonly source: FieldValueSource) {
    }

    public write(component: Component, entities: readonly Entity[]): void {
        fieldsOf(component)[this.key] = this.source.valueFor(entities);
    }
}

class SetterWrite implements FieldWrite {
    public constructor(private readonly setter: FieldSetter, private readonly source: FieldValueSource) {
    }

    public write(component: Component, entities: readonly Entity[]): void {
        this.setter.call(component, this.source.valueFor(entities));
    }
}

class SharedPropertyWrite implements FieldWrite {
    public constructor(private readonly key: string, private readonly value: unknown) {
    }

    public write(component: Component): void {
        fieldsOf(component)[this.key] = this.value;
    }
}

class SharedSetterWrite implements FieldWrite {
    public constructor(private readonly setter: FieldSetter, private readonly value: unknown) {
    }

    public write(component: Component): void {
        this.setter.call(component, this.value);
    }
}

class VectorInPlaceWrite implements FieldWrite {
    public constructor(private readonly key: string, private readonly vector: VectorFieldValue) {
    }

    public write(component: Component): void {
        const values = fieldsOf(component);
        const current = values[this.key];
        if (isNumberSlots(current) && this.vector.fits(current)) this.vector.copyInto(current);
        else values[this.key] = this.vector.valueFor();
    }
}

class VectorViewWrite implements FieldWrite {
    public constructor(private readonly getter: FieldGetter, private readonly vector: VectorFieldValue, private readonly fallback: FieldWrite) {
    }

    public write(component: Component, entities: readonly Entity[]): void {
        const view = this.getter.call(component);
        if (isNumberSlots(view) && this.vector.fits(view)) this.vector.copyInto(view);
        else this.fallback.write(component, entities);
    }
}

function structMemberValues(type: StructFieldType, json: SceneJsonObject, scope: PrefabFieldScope, path: string): StructMemberValue[] {
    const members: StructMemberValue[] = [];
    for (const member of type.fields) {
        const memberJson = json[member.key];
        if (memberJson === undefined) continue;
        const memberPath = `${path}.${member.key}`;
        const decoded = decodeFieldValue(member, memberJson, scope.context, memberPath);
        members.push({key: member.key, source: compileFieldValue(member, memberJson, decoded, scope, memberPath)});
    }
    return members;
}

function compileFieldValue(type: FieldType, json: SceneJsonValue, decoded: unknown, scope: PrefabFieldScope, path: string): FieldValueSource {
    switch (type.kind) {
        case "vec2":
        case "vec3":
        case "rotation":
            return new VectorFieldValue(decoded as ReadonlyVec<number>);
        case "textLines":
            return new TextLinesFieldValue(decoded as string[]);
        case "list": {
            const decodedElements = decoded as readonly unknown[];
            return new ListFieldValue((json as SceneJsonValue[]).map((element, index) => compileFieldValue(type.element, element, decodedElements[index], scope, `${path}[${index}]`)));
        }
        case "struct":
            if (decoded === undefined) return new SharedFieldValue(decoded);
            return new StructFieldValue(type, structMemberValues(type, json as SceneJsonObject, scope, path), scope.context, path);
        case "entity": {
            const sceneId = readSceneEntityId(json, path);
            const index = sceneId === null ? undefined : scope.entityIndexOf(sceneId);
            return new EntityFieldValue(index ?? NO_ENTITY_INDEX);
        }
        case "custom":
            return new DecodedFieldValue(type, json, scope.context, path);
        default:
            return new SharedFieldValue(decoded);
    }
}

function inheritedDescriptorOf(target: object, key: string): PropertyDescriptor | undefined {
    if (Object.prototype.hasOwnProperty.call(target, key)) return undefined;
    for (let owner: object | null = Object.getPrototypeOf(target); owner !== null; owner = Object.getPrototypeOf(owner)) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor !== undefined) return descriptor;
    }
    return undefined;
}

function liveViewGetterOf(probe: Component, otherProbe: Component, getter: FieldGetter | undefined, vector: VectorFieldValue): FieldGetter | undefined {
    if (getter === undefined) return undefined;
    const view = getter.call(probe);
    const ownView = view === getter.call(probe) && view !== getter.call(otherProbe);
    return ownView && isNumberSlots(view) && vector.fits(view) ? getter : undefined;
}

function fieldWriteFor(probe: Component, otherProbe: Component, field: FieldSchema, source: FieldValueSource): FieldWrite {
    if (source instanceof VectorFieldValue && copiesVectorInPlace(probe, field)) return new VectorInPlaceWrite(field.key, source);
    const descriptor = inheritedDescriptorOf(probe, field.key);
    const setter: FieldSetter | undefined = descriptor?.set;
    if (source instanceof SharedFieldValue) return setter === undefined ? new SharedPropertyWrite(field.key, source.value) : new SharedSetterWrite(setter, source.value);
    const write = setter === undefined ? new PropertyWrite(field.key, source) : new SetterWrite(setter, source);
    if (!(source instanceof VectorFieldValue)) return write;
    const liveView = liveViewGetterOf(probe, otherProbe, descriptor?.get, source);
    return liveView === undefined ? write : new VectorViewWrite(liveView, source, write);
}

export class ComponentSpawnPlan {
    private readonly requiredEntityKeys: readonly string[];

    public constructor(private readonly schema: ComponentSchema, private readonly writes: readonly FieldWrite[]) {
        this.requiredEntityKeys = schema.fields.filter(field => isEntityField(field) && !field.nullable).map(field => field.key);
    }

    public get ctor(): ComponentCtor<Component> {
        return this.schema.ctor;
    }

    public create(entities: readonly Entity[]): Component {
        const component = this.schema.create();
        const writes = this.writes;
        for (let i = 0; i < writes.length; i++) writes[i].write(component, entities);
        return component;
    }

    public createReferring(entities: readonly Entity[]): Component | undefined {
        const component = this.create(entities);
        const values = fieldsOf(component);
        const required = this.requiredEntityKeys;
        for (let i = 0; i < required.length; i++) if (values[required[i]] === NULL_ENTITY) return undefined;
        return component;
    }
}

export function compileComponentSpawnPlan(schema: ComponentSchema, fields: readonly AuthoredField[], scope: PrefabFieldScope): ComponentSpawnPlan {
    const probe = schema.create();
    const otherProbe = schema.create();
    const writes = fields.map(authored => fieldWriteFor(probe, otherProbe, authored.field, compileFieldValue(authored.field, authored.json, authored.decoded, scope, authored.path)));
    return new ComponentSpawnPlan(schema, writes);
}
