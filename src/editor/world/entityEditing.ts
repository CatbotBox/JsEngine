import type {Component, Entity, World} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {ComponentType} from "../../engine/core/componentType";
import {Parent, ParentTransform} from "../../engine/translation/parent";
import {Children} from "../../engine/translation/children";
import {LocalPosition} from "../../engine/translation/localPosition";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {decodeFieldValue, isEntityField, isSceneJsonObject} from "../../engine/scene";
import type {ComponentSchema, ComponentSchemaRegistry, FieldDecodeContext, FieldSchema, SceneAssetLoader, SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {EditorFieldValue} from "../editorProtocol";
import {encodeEditorFieldValue, isLiveEntity, parentOf, requireLiveEntity} from "./entityInspection";

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

function quotedKeys(keys: readonly string[]): string {
    return keys.map(key => JSON.stringify(key)).join(", ");
}

export function requireFieldsSchema(registry: ComponentSchemaRegistry, typeName: string): ComponentSchema {
    const schema = registry.byName(typeName);
    if (schema === undefined) throw new Error(`No component type named "${typeName}" is registered`);
    if (schema.persistence !== "fields") {
        throw new Error(`${typeName} is ${schema.persistence}: the editor only adds, removes and edits components saved with their fields`);
    }
    return schema;
}

function requireField(schema: ComponentSchema, key: string): FieldSchema {
    const field = schema.fields.find(candidate => candidate.key === key);
    if (field === undefined) throw new Error(`${schema.name} has no field "${key}"`);
    return field;
}

function decodeContext(world: World, assets: SceneAssetLoader): FieldDecodeContext {
    return {
        entityOf: entity => isLiveEntity(world, entity) ? entity as Entity : undefined,
        reportDanglingEntity: path => {
            throw new Error(`${path} names no entity of this world`);
        },
        assets,
    };
}

function missingRequiredEntities(schema: ComponentSchema, component: Component): string[] {
    const values = fieldsOf(component);
    return schema.fields.filter(field => isEntityField(field) && !field.nullable && values[field.key] === NULL_ENTITY).map(field => field.key);
}

export function assetPathsOf(registry: ComponentSchemaRegistry, typeName: string, values: SceneJsonObject): string[] {
    const schema = registry.byName(typeName);
    if (schema === undefined) return [];
    return schema.fields.flatMap(field => {
        if (field.kind !== "mesh" && field.kind !== "spriteImage") return [];
        const value = values[field.key];
        return isSceneJsonObject(value) && typeof value.path === "string" ? [value.path] : [];
    });
}

function childrenByParent(world: World): Map<Entity, Set<Entity>> {
    const childrenType = ComponentType.of(Children);
    const parentType = ComponentType.of(Parent);
    const byParent = new Map<Entity, Set<Entity>>();
    const link = (parent: Entity, child: Entity) => {
        let children = byParent.get(parent);
        if (children === undefined) byParent.set(parent, children = new Set());
        children.add(child);
    };
    for (const archetype of world.archetypes.values()) {
        const childrenColumn = archetype.getColumn(childrenType);
        const parentColumn = archetype.getColumn(parentType);
        if (childrenColumn === undefined && parentColumn === undefined) continue;
        const count = archetype.entityCountIncludingDisabled;
        for (let row = 0; row < count; row++) {
            const entity = archetype.getEntityAtIndex(row);
            if (childrenColumn !== undefined) for (const child of (childrenColumn.get(row) as Children).children) link(entity, child);
            if (parentColumn !== undefined) link((parentColumn.get(row) as Parent).entity, entity);
        }
    }
    return byParent;
}

export function subtreeOf(world: World, root: Entity): Entity[] {
    const byParent = childrenByParent(world);
    const subtree = [root];
    const seen = new Set<Entity>(subtree);
    for (let i = 0; i < subtree.length; i++) {
        for (const child of byParent.get(subtree[i]) ?? []) {
            if (seen.has(child) || !isLiveEntity(world, child)) continue;
            seen.add(child);
            subtree.push(child);
        }
    }
    return subtree;
}

function requireNoCycle(world: World, child: Entity, parent: Entity): void {
    if (subtreeOf(world, child).includes(parent)) {
        throw new Error(`Entity ${parent} is entity ${child} or one of its descendants, so it cannot become its parent`);
    }
}

function linkChild(world: World, child: Entity, parent: Entity): void {
    const entityManager = world.entityManager;
    const children = entityManager.getComponent<Children>(parent, Children);
    if (children === undefined) entityManager.addComponent(parent, new Children(child));
    else children.addChild(child);
}

function unlinkChild(world: World, child: Entity, parent: Entity): void {
    if (!isLiveEntity(world, parent)) return;
    world.entityManager.getComponent<Children>(parent, Children)?.removeChild(child);
}

function reparent(world: World, child: Entity, link: Parent, parent: Entity): void {
    requireNoCycle(world, child, parent);
    const previous = link.entity;
    if (previous === parent) return;
    unlinkChild(world, child, previous);
    link.entity = parent;
    linkChild(world, child, parent);
}

export function assignField(
    world: World,
    registry: ComponentSchemaRegistry,
    assets: SceneAssetLoader,
    entity: Entity,
    typeName: string,
    key: string,
    json: SceneJsonValue,
): EditorFieldValue {
    requireLiveEntity(world, entity);
    const schema = requireFieldsSchema(registry, typeName);
    const field = requireField(schema, key);
    const path = `${typeName}.${key}`;
    const component = world.entityManager.getComponent<Component>(entity, ComponentType.of(schema.ctor));
    if (component === undefined) throw new Error(`Entity ${entity} has no ${typeName}`);
    const value = decodeFieldValue(field, json, decodeContext(world, assets), path);
    if (isEntityField(field) && !field.nullable && value === NULL_ENTITY) {
        throw new Error(`${path} cannot be null; remove the ${typeName} component instead`);
    }
    if (component instanceof Parent) reparent(world, entity, component, value as Entity);
    else fieldsOf(component)[key] = value;
    return encodeEditorFieldValue(world, field, fieldsOf(component)[key], path);
}

export function addComponentTo(
    world: World,
    registry: ComponentSchemaRegistry,
    assets: SceneAssetLoader,
    entity: Entity,
    typeName: string,
    values: SceneJsonObject,
): void {
    requireLiveEntity(world, entity);
    const schema = requireFieldsSchema(registry, typeName);
    const entityManager = world.entityManager;
    if (entityManager.hasComponent(entity, ComponentType.of(schema.ctor))) throw new Error(`Entity ${entity} already has ${typeName}`);
    const unknownKeys = Object.keys(values).filter(key => !schema.fields.some(field => field.key === key));
    if (unknownKeys.length > 0) throw new Error(`${typeName} has no field${unknownKeys.length === 1 ? "" : "s"} ${quotedKeys(unknownKeys)}`);
    const component = schema.create();
    const context = decodeContext(world, assets);
    for (const field of schema.fields) {
        const json = values[field.key];
        if (json !== undefined) fieldsOf(component)[field.key] = decodeFieldValue(field, json, context, `${typeName}.${field.key}`);
    }
    const missing = missingRequiredEntities(schema, component);
    if (missing.length > 0) throw new Error(`${typeName} needs ${quotedKeys(missing)} set to an entity in its values`);
    if (component instanceof Parent) requireNoCycle(world, entity, component.entity);
    entityManager.addComponent(entity, component);
    if (component instanceof Parent) linkChild(world, entity, component.entity);
}

export function removeComponentFrom(world: World, registry: ComponentSchemaRegistry, entity: Entity, typeName: string): void {
    requireLiveEntity(world, entity);
    const schema = requireFieldsSchema(registry, typeName);
    const entityManager = world.entityManager;
    const type = ComponentType.of(schema.ctor);
    if (!entityManager.hasComponent(entity, type)) throw new Error(`Entity ${entity} has no ${typeName}`);
    if (schema.ctor === Parent) {
        const parent = parentOf(world, entity);
        if (parent !== undefined) unlinkChild(world, entity, parent);
        entityManager.removeComponent(entity, ParentTransform);
    }
    entityManager.removeComponent(entity, type);
}

export function createEditorEntity(world: World, name: string | undefined, parent: Entity | undefined): Entity {
    if (parent !== undefined) requireLiveEntity(world, parent);
    const components: Component[] = [new LocalPosition(), new LocalToWorld()];
    if (parent !== undefined) components.push(new Parent(parent));
    const entity = world.entityManager.createEntity(name, components);
    if (parent !== undefined) linkChild(world, entity, parent);
    return entity;
}

export function destroyWithDescendants(world: World, root: Entity): Entity[] {
    requireLiveEntity(world, root);
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
    requireLiveEntity(world, entity);
    world.entityManager.setEnabledState(entity, enabled);
}

export function destroyAllEntities(world: World, entities: readonly Entity[]): void {
    const entityManager = world.entityManager;
    for (const entity of entities) if (entityManager.exists(entity)) entityManager.destroyEntity(entity);
}
