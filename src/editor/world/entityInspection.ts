import type {Component, Entity, World} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import type {EntityArchetype} from "../../engine/core/entityArchetype";
import {getEntityCreationOrder, getOwner} from "../../engine/core/ownership";
import type {AnyCT} from "../../engine/util/tokenUtils";
import {Parent} from "../../engine/translation/parent";
import {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {
    categoryOf,
    childEntitiesOf,
    EditorOnly,
    encodeFieldValue,
    inferComponentSchema,
    orderedSceneRoots,
    PrefabInstance,
    siblingOrderOf,
} from "../../engine/scene";
import type {ComponentSchema, ComponentSchemaRegistry, FieldEncodeContext, FieldSchema} from "../../engine/scene";
import {ENTITY_HANDLE_LIMIT} from "../editorProtocol";
import type {
    DescribeSchemasResult,
    EditorComponentDescription,
    EditorComponentDetails,
    EditorEntityDetails,
    EditorEntitySummary,
    EditorFieldDescription,
    EditorFieldValue,
    ListEntitiesResult,
} from "../editorProtocol";

interface EntityRow {
    readonly entity: Entity;
    readonly enabled: boolean;
    readonly archetype: EntityArchetype<AnyCT>;
    readonly row: number;
}

const editorOnlyType = (): AnyCT => ComponentType.of(EditorOnly);

function ignore(): void {
}

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

export function isLiveEntity(world: World, entity: number): boolean {
    return Number.isInteger(entity) && entity > 0 && entity < ENTITY_HANDLE_LIMIT && world.entityManager.exists(entity as Entity);
}

export function isEditorOnlyEntity(world: World, entity: Entity): boolean {
    return getOwner(world, entity)?.getColumn(editorOnlyType()) !== undefined;
}

export function isSceneEntityHandle(world: World, entity: number): boolean {
    return isLiveEntity(world, entity) && !isEditorOnlyEntity(world, entity as Entity);
}

export function requireSceneEntity(world: World, entity: Entity): Entity {
    if (!isSceneEntityHandle(world, entity)) throw new Error(`No entity ${entity} in this world`);
    return entity;
}

function describeField(field: FieldSchema): EditorFieldDescription {
    switch (field.kind) {
        case "enum":
            return {key: field.key, kind: field.kind, enumNames: field.members.map(member => member.name)};
        case "string":
        case "entity":
            return {key: field.key, kind: field.kind, nullable: field.nullable};
        default:
            return {key: field.key, kind: field.kind};
    }
}

function describeComponent(schema: ComponentSchema): EditorComponentDescription {
    return {
        typeName: schema.name,
        persistence: schema.persistence,
        fields: schema.fields.map(describeField),
        inferred: schema.inferred === true,
        category: categoryOf(schema),
    };
}

function isSceneArchetype(archetype: EntityArchetype<AnyCT>): boolean {
    return archetype.getColumn(editorOnlyType()) === undefined;
}

export function unregisteredComponentTypes(world: World, registry: ComponentSchemaRegistry): Map<AnyCT, Component> {
    const found = new Map<AnyCT, Component>();
    for (const archetype of world.archetypes.values()) {
        if (!isSceneArchetype(archetype) || archetype.entityCountIncludingDisabled === 0) continue;
        for (const type of archetype.componentTypes) {
            if (found.has(type) || registry.byType(type) !== undefined) continue;
            found.set(type, archetype.getColumn(type)!.get(0) as Component);
        }
    }
    return found;
}

export function describeSchemas(world: World, registry: ComponentSchemaRegistry): DescribeSchemasResult {
    const inferred = [...unregisteredComponentTypes(world, registry).values()]
        .map(instance => inferComponentSchema(instance))
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
        components: [...registry.schemas, ...inferred].map(describeComponent),
        resources: registry.resourceSchemas.map(schema => ({typeName: schema.name, fields: schema.fields.map(describeField)})),
    };
}

function sceneRowsInCreationOrder(world: World): EntityRow[] {
    const rows: EntityRow[] = [];
    for (const archetype of world.archetypes.values()) {
        if (!isSceneArchetype(archetype)) continue;
        const count = archetype.entityCountIncludingDisabled;
        for (let row = 0; row < count; row++) {
            rows.push({entity: archetype.getEntityAtIndex(row), enabled: archetype.isEntityIndexEnabled(row), archetype, row});
        }
    }
    return rows.sort((a, b) => getEntityCreationOrder(a.entity)! - getEntityCreationOrder(b.entity)!);
}

export function entitiesInCreationOrder(world: World): Entity[] {
    return sceneRowsInCreationOrder(world).map(row => row.entity);
}

export function componentTypeName(registry: ComponentSchemaRegistry, type: AnyCT): string {
    return registry.byType(type)?.name ?? type.ctor.name;
}

function orderedComponentTypes(registry: ComponentSchemaRegistry, types: readonly AnyCT[]): AnyCT[] {
    const registryOrder = (type: AnyCT) => registry.indexOf(registry.byType(type)!);
    const registered = types.filter(type => registry.byType(type) !== undefined).sort((a, b) => registryOrder(a) - registryOrder(b));
    const unregistered = types.filter(type => registry.byType(type) === undefined).sort((a, b) => a.ctor.name.localeCompare(b.ctor.name));
    return [...registered, ...unregistered];
}

function parentInRow(world: World, archetype: EntityArchetype<AnyCT>, row: number): Entity | null {
    const link = archetype.getColumn(ComponentType.of(Parent))?.get(row) as Parent | undefined;
    return link !== undefined && isSceneEntityHandle(world, link.entity) && link.entity !== archetype.getEntityAtIndex(row) ? link.entity : null;
}

export function parentOf(world: World, entity: Entity): Entity | undefined {
    const archetype = getOwner(world, entity);
    const row = archetype?.getIndexOfEntity(entity);
    if (archetype === undefined || row === undefined) return undefined;
    return parentInRow(world, archetype, row) ?? undefined;
}

function prefabSourcePathInRow(archetype: EntityArchetype<AnyCT>, row: number): string | null {
    const instance = archetype.getColumn(ComponentType.of(PrefabInstance))?.get(row) as PrefabInstance | undefined;
    return instance === undefined ? null : instance.sourcePath;
}

export function sceneRoots(world: World): Entity[] {
    return orderedSceneRoots(world, entitiesInCreationOrder(world).filter(entity => parentOf(world, entity) === undefined));
}

export function siblingIndexOf(world: World, entity: Entity): number {
    const parent = parentOf(world, entity);
    if (parent === undefined) return Math.max(0, sceneRoots(world).indexOf(entity));
    const index = childEntitiesOf(world, parent).indexOf(entity);
    if (index >= 0) return index;
    const order = siblingOrderOf(world, entitiesInCreationOrder(world));
    return order.siblingIndexOf.get(entity) ?? 0;
}

export function listEntities(world: World, registry: ComponentSchemaRegistry): ListEntitiesResult {
    const namesByArchetype = new Map<EntityArchetype<AnyCT>, readonly string[]>();
    const namesOf = (archetype: EntityArchetype<AnyCT>): readonly string[] => {
        let names = namesByArchetype.get(archetype);
        if (names === undefined) {
            names = orderedComponentTypes(registry, archetype.componentTypes).map(type => componentTypeName(registry, type));
            namesByArchetype.set(archetype, names);
        }
        return names;
    };
    const rows = sceneRowsInCreationOrder(world);
    const order = siblingOrderOf(world, rows.map(row => row.entity));
    const entities = rows.map(({entity, enabled, archetype, row}): EditorEntitySummary => ({
        entity,
        name: world.entityManager.nameOf(entity) ?? null,
        enabled,
        parent: parentInRow(world, archetype, row),
        siblingIndex: order.siblingIndexOf.get(entity) ?? 0,
        prefabSourcePath: prefabSourcePathInRow(archetype, row),
        componentTypeNames: namesOf(archetype),
    }));
    return {entities};
}

function editorEncodeContext(world: World): FieldEncodeContext {
    return {
        sceneIdOf: entity => isLiveEntity(world, entity) ? entity : undefined,
        reportDanglingEntity: ignore,
        reportUnsavedAsset: ignore,
    };
}

export function encodeEditorFieldValue(world: World, field: FieldSchema, value: unknown, path: string): EditorFieldValue {
    if (field.kind === "spriteImage" && value instanceof SpriteImage && value.sourcePath === undefined) {
        return {inline: {width: value.sizeX, height: value.sizeY}};
    }
    return encodeFieldValue(field, value, editorEncodeContext(world), path);
}

export function schemaOfComponent(registry: ComponentSchemaRegistry, type: AnyCT, component: Component): ComponentSchema {
    return registry.byType(type) ?? inferComponentSchema(component);
}

function componentDetails(world: World, registry: ComponentSchemaRegistry, type: AnyCT, component: Component): EditorComponentDetails {
    const schema = schemaOfComponent(registry, type, component);
    const values = fieldsOf(component);
    const fields: {[key: string]: EditorFieldValue} = {};
    for (const field of schema.fields) fields[field.key] = encodeEditorFieldValue(world, field, values[field.key], `${schema.name}.${field.key}`);
    return {typeName: schema.name, inspectable: schema.persistence === "fields", inferred: schema.inferred === true, fields};
}

export function entityDetails(world: World, registry: ComponentSchemaRegistry, entity: Entity): EditorEntityDetails {
    requireSceneEntity(world, entity);
    const archetype = getOwner(world, entity)!;
    const row = archetype.getIndexOfEntity(entity)!;
    return {
        entity,
        name: world.entityManager.nameOf(entity) ?? null,
        enabled: archetype.isEntityIndexEnabled(row),
        parent: parentInRow(world, archetype, row),
        siblingIndex: siblingIndexOf(world, entity),
        prefabSourcePath: prefabSourcePathInRow(archetype, row),
        components: orderedComponentTypes(registry, archetype.componentTypes)
            .map(type => componentDetails(world, registry, type, archetype.getColumn(type)!.get(row))),
    };
}
