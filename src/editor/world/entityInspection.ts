import type {Component, Entity, World} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import type {EntityArchetype} from "../../engine/core/entityArchetype";
import {getEntityCreationOrder, getOwner} from "../../engine/core/ownership";
import type {AnyCT} from "../../engine/util/tokenUtils";
import {Parent} from "../../engine/translation/parent";
import {SpriteImage} from "../../engine/rendering/2d/spriteImage";
import {encodeFieldValue} from "../../engine/scene";
import type {ComponentSchemaRegistry, FieldEncodeContext, FieldSchema} from "../../engine/scene";
import {ENTITY_HANDLE_LIMIT} from "../editorProtocol";
import type {
    DescribeSchemasResult,
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

function ignore(): void {
}

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

export function isLiveEntity(world: World, entity: number): boolean {
    return Number.isInteger(entity) && entity > 0 && entity < ENTITY_HANDLE_LIMIT && world.entityManager.exists(entity as Entity);
}

export function requireLiveEntity(world: World, entity: Entity): Entity {
    if (!isLiveEntity(world, entity)) throw new Error(`No entity ${entity} in this world`);
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

export function describeSchemas(registry: ComponentSchemaRegistry): DescribeSchemasResult {
    return {
        components: registry.schemas.map(schema => ({
            typeName: schema.name,
            persistence: schema.persistence,
            fields: schema.fields.map(describeField),
        })),
    };
}

function entityRowsInCreationOrder(world: World): EntityRow[] {
    const rows: EntityRow[] = [];
    for (const archetype of world.archetypes.values()) {
        const count = archetype.entityCountIncludingDisabled;
        for (let row = 0; row < count; row++) {
            rows.push({entity: archetype.getEntityAtIndex(row), enabled: archetype.isEntityIndexEnabled(row), archetype, row});
        }
    }
    return rows.sort((a, b) => getEntityCreationOrder(a.entity)! - getEntityCreationOrder(b.entity)!);
}

export function entitiesInCreationOrder(world: World): Entity[] {
    return entityRowsInCreationOrder(world).map(row => row.entity);
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
    return link !== undefined && isLiveEntity(world, link.entity) ? link.entity : null;
}

export function parentOf(world: World, entity: Entity): Entity | undefined {
    const archetype = getOwner(world, entity);
    const row = archetype?.getIndexOfEntity(entity);
    if (archetype === undefined || row === undefined) return undefined;
    return parentInRow(world, archetype, row) ?? undefined;
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
    const entities = entityRowsInCreationOrder(world).map(({entity, enabled, archetype, row}): EditorEntitySummary => ({
        entity,
        name: world.entityManager.nameOf(entity) ?? null,
        enabled,
        parent: parentInRow(world, archetype, row),
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

function componentDetails(world: World, registry: ComponentSchemaRegistry, type: AnyCT, component: Component): EditorComponentDetails {
    const schema = registry.byType(type);
    if (schema === undefined) return {typeName: type.ctor.name, inspectable: false, fields: {}};
    const values = fieldsOf(component);
    const fields: {[key: string]: EditorFieldValue} = {};
    for (const field of schema.fields) fields[field.key] = encodeEditorFieldValue(world, field, values[field.key], `${schema.name}.${field.key}`);
    return {typeName: schema.name, inspectable: schema.persistence === "fields", fields};
}

export function entityDetails(world: World, registry: ComponentSchemaRegistry, entity: Entity): EditorEntityDetails {
    requireLiveEntity(world, entity);
    const archetype = getOwner(world, entity)!;
    const row = archetype.getIndexOfEntity(entity)!;
    return {
        entity,
        name: world.entityManager.nameOf(entity) ?? null,
        enabled: archetype.isEntityIndexEnabled(row),
        parent: parentInRow(world, archetype, row),
        components: orderedComponentTypes(registry, archetype.componentTypes)
            .map(type => componentDetails(world, registry, type, archetype.getColumn(type)!.get(row))),
    };
}
