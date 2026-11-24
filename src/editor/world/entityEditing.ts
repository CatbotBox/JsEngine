import type {Component, ComponentCtor, Entity, World} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {ComponentType} from "../../engine/core/componentType";
import {getOwner} from "../../engine/core/ownership";
import type {AnyCT} from "../../engine/util/tokenUtils";
import {Parent, ParentTransform} from "../../engine/translation/parent";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import type {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {
    assetReferencesOfFields,
    assignFieldValue,
    decodeFieldValue,
    EditorOnly,
    inferComponentSchema,
    isEntityField,
    untrackedComponentOf,
} from "../../engine/scene";
import type {
    ComponentSchema,
    ComponentSchemaRegistry,
    FieldDecodeContext,
    FieldSchema,
    SceneAssetLoader,
    SceneAssetReference,
    SceneJsonObject,
    SceneJsonValue,
} from "../../engine/scene";
import type {EditorComponentValues, EditorFieldEdit, EditorFieldValue} from "../editorProtocol";
import {encodeEditorFieldValue, encodeFullFieldValue, isSceneEntityHandle, parentOf, requireSceneEntity, unregisteredComponentTypes} from "./entityInspection";
import {linkChild, reparentKeepingLocals, requireNoCycle, subtreeOf, unlinkChild} from "./hierarchyEditing";

interface EditableComponent {
    readonly schema: ComponentSchema;
    readonly type: AnyCT;
    readonly inferred: boolean;
}

interface PreparedEdit {
    readonly edit: EditorFieldEdit;
    readonly target: EditableComponent;
    readonly field: FieldSchema;
    readonly value: unknown;
}

const NO_INITIAL_COMPONENTS: EditorComponentValues = {};

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

function quotedKeys(keys: readonly string[]): string {
    return keys.map(key => JSON.stringify(key)).join(", ");
}

function notFieldsPersistence(schema: ComponentSchema): Error {
    return new Error(`${schema.name} is ${schema.persistence}: the editor only adds, removes and edits components saved with their fields`);
}

export function requireFieldsSchema(registry: ComponentSchemaRegistry, typeName: string): ComponentSchema {
    const schema = registry.byName(typeName);
    if (schema === undefined) throw new Error(`No component type named "${typeName}" is registered`);
    if (schema.persistence !== "fields") throw notFieldsPersistence(schema);
    return schema;
}

function unregisteredTypeNamed(world: World, registry: ComponentSchemaRegistry, typeName: string): AnyCT | undefined {
    const matches = [...unregisteredComponentTypes(world, registry).keys()].filter(type => type.ctor.name === typeName);
    if (matches.length > 1) throw new Error(`More than one unregistered component class is named "${typeName}"; register a schema for them`);
    return matches[0];
}

function editableComponentOf(world: World, registry: ComponentSchemaRegistry, entity: Entity, typeName: string): EditableComponent {
    const registered = registry.byName(typeName);
    if (registered !== undefined) {
        if (registered.persistence !== "fields") throw notFieldsPersistence(registered);
        const type = ComponentType.of(registered.ctor);
        if (!world.entityManager.hasComponent(entity, type)) throw new Error(`Entity ${entity} has no ${typeName}`);
        return {schema: registered, type, inferred: false};
    }
    const archetype = getOwner(world, entity)!;
    const own = archetype.componentTypes.find(type =>
        type.ctor.name === typeName && registry.byType(type) === undefined && type !== ComponentType.of(EditorOnly));
    if (own !== undefined) {
        const instance = untrackedComponentOf<Component>(world, entity, own)!;
        return {schema: inferComponentSchema(instance), type: own, inferred: true};
    }
    if (unregisteredTypeNamed(world, registry, typeName) !== undefined) throw new Error(`Entity ${entity} has no ${typeName}`);
    throw new Error(`No component type named "${typeName}" is registered`);
}

function requireField(schema: ComponentSchema, key: string): FieldSchema {
    const field = schema.fields.find(candidate => candidate.key === key);
    if (field === undefined) throw new Error(`${schema.name} has no field "${key}"`);
    return field;
}

export function editorDecodeContext(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader): FieldDecodeContext {
    return {
        entityOf: entity => isSceneEntityHandle(world, entity) ? entity as Entity : undefined,
        reportDanglingEntity: path => {
            throw new Error(`${path} names no entity of this world`);
        },
        assets,
        inlineSpriteImages: new Map<string, SpriteImage>(),
        fieldTypes: registry,
    };
}

function missingRequiredEntities(schema: ComponentSchema, component: Component): string[] {
    const values = fieldsOf(component);
    return schema.fields.filter(field => isEntityField(field) && !field.nullable && values[field.key] === NULL_ENTITY).map(field => field.key);
}

export function markComponentChanged(world: World, entity: Entity, type: AnyCT): void {
    const archetype = getOwner(world, entity);
    const row = archetype?.getIndexOfEntity(entity);
    if (archetype === undefined || row === undefined) return;
    archetype.getColumn(type)?.markBlockAt(row, world.changeStamps.current);
}

export function assetReferencesOf(registry: ComponentSchemaRegistry, typeName: string, values: SceneJsonObject): SceneAssetReference[] {
    const schema = registry.byName(typeName);
    return schema === undefined ? [] : assetReferencesOfFields(schema.fields, values);
}

export function assetReferencesOfEdits(registry: ComponentSchemaRegistry, edits: readonly EditorFieldEdit[]): SceneAssetReference[] {
    return edits.flatMap(edit => assetReferencesOf(registry, edit.typeName, {[edit.key]: edit.value}));
}

function prepareEdit(world: World, registry: ComponentSchemaRegistry, context: FieldDecodeContext, edit: EditorFieldEdit): PreparedEdit {
    requireSceneEntity(world, edit.entity);
    const target = editableComponentOf(world, registry, edit.entity, edit.typeName);
    const field = requireField(target.schema, edit.key);
    const path = `${edit.typeName}.${edit.key}`;
    const value = decodeFieldValue(field, edit.value, context, path);
    if (isEntityField(field) && !field.nullable && value === NULL_ENTITY) {
        throw new Error(`${path} cannot be null; remove the ${edit.typeName} component instead`);
    }
    return {edit, target, field, value};
}

function applyEdit(world: World, prepared: PreparedEdit): void {
    const {edit, target, field, value} = prepared;
    if (target.inferred) {
        assignFieldValue(untrackedComponentOf<Component>(world, edit.entity, target.type)!, field, value);
        markComponentChanged(world, edit.entity, target.type);
        return;
    }
    const component = world.entityManager.getComponent<Component>(edit.entity, target.type)!;
    if (component instanceof Parent) reparentKeepingLocals(world, edit.entity, component, value as Entity);
    else assignFieldValue(component, field, value);
}

function encodedValueOf(world: World, registry: ComponentSchemaRegistry, prepared: PreparedEdit): EditorFieldValue {
    const component = untrackedComponentOf<Component>(world, prepared.edit.entity, prepared.target.type)!;
    return encodeEditorFieldValue(world, registry, prepared.field, fieldsOf(component)[prepared.field.key], `${prepared.edit.typeName}.${prepared.edit.key}`);
}

export function fullFieldValueOf(world: World, registry: ComponentSchemaRegistry, entity: Entity, typeName: string, key: string): SceneJsonValue {
    requireSceneEntity(world, entity);
    const target = editableComponentOf(world, registry, entity, typeName);
    const field = requireField(target.schema, key);
    const component = untrackedComponentOf<Component>(world, entity, target.type)!;
    return encodeFullFieldValue(world, registry, field, fieldsOf(component)[key], `${typeName}.${key}`);
}

export function assignField(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader, edit: EditorFieldEdit): EditorFieldValue {
    const prepared = prepareEdit(world, registry, editorDecodeContext(world, registry, assets), edit);
    if (prepared.target.schema.ctor === Parent) requireNoCycle(world, edit.entity, prepared.value as Entity);
    applyEdit(world, prepared);
    return encodedValueOf(world, registry, prepared);
}

export function assignFields(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader, edits: readonly EditorFieldEdit[]): EditorFieldValue[] {
    const context = editorDecodeContext(world, registry, assets);
    const prepared = edits.map((edit, index) => {
        if (registry.byName(edit.typeName)?.ctor === Parent) throw new Error(`edits[${index}]: setFields cannot edit Parent; use setParent`);
        try {
            return prepareEdit(world, registry, context, edit);
        } catch (error) {
            throw new Error(`edits[${index}]: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    for (const edit of prepared) applyEdit(world, edit);
    return prepared.map(edit => encodedValueOf(world, registry, edit));
}

function decodeValuesOnto(
    world: World,
    registry: ComponentSchemaRegistry,
    assets: SceneAssetLoader,
    schema: ComponentSchema,
    component: Component,
    values: SceneJsonObject,
    typeName: string,
): void {
    const unknownKeys = Object.keys(values).filter(key => !schema.fields.some(field => field.key === key));
    if (unknownKeys.length > 0) throw new Error(`${typeName} has no field${unknownKeys.length === 1 ? "" : "s"} ${quotedKeys(unknownKeys)}`);
    const context = editorDecodeContext(world, registry, assets);
    for (const field of schema.fields) {
        const json = values[field.key];
        if (json === undefined) continue;
        const value = decodeFieldValue(field, json, context, `${typeName}.${field.key}`);
        assignFieldValue(component, field, value);
    }
}

function createInferred(type: AnyCT, typeName: string): Component {
    try {
        return new (type.ctor as ComponentCtor<Component>)();
    } catch (error) {
        throw new Error(`${typeName} could not be created without constructor arguments: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function addComponentTo(
    world: World,
    registry: ComponentSchemaRegistry,
    assets: SceneAssetLoader,
    entity: Entity,
    typeName: string,
    values: SceneJsonObject,
): void {
    requireSceneEntity(world, entity);
    const entityManager = world.entityManager;
    const registered = registry.byName(typeName);
    if (registered === undefined) {
        const type = unregisteredTypeNamed(world, registry, typeName);
        if (type === undefined) throw new Error(`No component type named "${typeName}" is registered`);
        if (entityManager.hasComponent(entity, type)) throw new Error(`Entity ${entity} already has ${typeName}`);
        const component = createInferred(type, typeName);
        decodeValuesOnto(world, registry, assets, inferComponentSchema(component), component, values, typeName);
        entityManager.addComponent(entity, component);
        return;
    }
    const schema = requireFieldsSchema(registry, typeName);
    if (entityManager.hasComponent(entity, ComponentType.of(schema.ctor))) throw new Error(`Entity ${entity} already has ${typeName}`);
    const component = schema.create();
    decodeValuesOnto(world, registry, assets, schema, component, values, typeName);
    const missing = missingRequiredEntities(schema, component);
    if (missing.length > 0) throw new Error(`${typeName} needs ${quotedKeys(missing)} set to an entity in its values`);
    if (component instanceof Parent) requireNoCycle(world, entity, component.entity);
    entityManager.addComponent(entity, component);
    if (component instanceof Parent) linkChild(world, entity, component.entity);
}

export function removeComponentFrom(world: World, registry: ComponentSchemaRegistry, entity: Entity, typeName: string): void {
    requireSceneEntity(world, entity);
    const target = editableComponentOf(world, registry, entity, typeName);
    const entityManager = world.entityManager;
    if (target.schema.ctor === Parent) {
        const parent = parentOf(world, entity);
        if (parent !== undefined) unlinkChild(world, entity, parent);
        entityManager.removeComponent(entity, ParentTransform);
    }
    entityManager.removeComponent(entity, target.type);
}

export function renameEntity(world: World, entity: Entity, name: string | null): void {
    requireSceneEntity(world, entity);
    world.entityManager.setName(entity, name ?? undefined);
}

function initialComponent(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader, typeName: string, values: SceneJsonObject): Component {
    const schema = requireFieldsSchema(registry, typeName);
    if (schema.ctor === Parent) throw new Error("A new entity takes its parent from parent, not from a Parent component");
    const component = schema.create();
    decodeValuesOnto(world, registry, assets, schema, component, values, typeName);
    const missing = missingRequiredEntities(schema, component);
    if (missing.length > 0) throw new Error(`${typeName} needs ${quotedKeys(missing)} set to an entity in its values`);
    return component;
}

export function createEditorEntity(
    world: World,
    registry: ComponentSchemaRegistry,
    assets: SceneAssetLoader,
    name: string | undefined,
    parent: Entity | undefined,
    initial: EditorComponentValues = NO_INITIAL_COMPONENTS,
): Entity {
    if (parent !== undefined) requireSceneEntity(world, parent);
    const requested = Object.entries(initial).map(([typeName, values]) => initialComponent(world, registry, assets, typeName, values));
    const requestedTypes = new Set(requested.map(component => component.constructor));
    const defaults = [new LocalPosition(), new LocalToWorld()].filter(component => !requestedTypes.has(component.constructor));
    const components: Component[] = [...defaults, ...requested];
    if (parent !== undefined) components.push(new Parent(parent));
    const entity = world.entityManager.createEntity(name, components);
    if (parent !== undefined) linkChild(world, entity, parent);
    return entity;
}

export function destroyWithDescendants(world: World, root: Entity): Entity[] {
    requireSceneEntity(world, root);
    const doomed = subtreeOf(world, root);
    const doomedSet = new Set(doomed);
    for (const entity of doomed) {
        const parent = parentOf(world, entity);
        if (parent !== undefined && !doomedSet.has(parent)) unlinkChild(world, entity, parent);
    }
    const entityManager = world.entityManager;
    for (const entity of doomed) if (entityManager.exists(entity)) entityManager.destroyEntity(entity);
    return doomed;
}

export function setEntityEnabled(world: World, entity: Entity, enabled: boolean): void {
    requireSceneEntity(world, entity);
    world.entityManager.setEnabledState(entity, enabled);
}

export function destroyAllEntities(world: World, entities: readonly Entity[]): void {
    const entityManager = world.entityManager;
    for (const entity of entities) if (entityManager.exists(entity)) entityManager.destroyEntity(entity);
}
