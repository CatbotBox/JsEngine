import type {Resource, World} from "../../engine/core";
import {NULL_ENTITY} from "../../engine/core/entity";
import {getOwner} from "../../engine/core/ownership";
import type {EntityArchetype} from "../../engine/core/entityArchetype";
import type {AnyCT} from "../../engine/util/tokenUtils";
import {
    assetReferencesOfFields,
    categoryOf,
    dataAssetPathOf,
    assignFieldValue,
    decodeFieldValue,
    encodeDataAssetFields,
    ENGINE_COMPONENT_CATEGORIES,
    isEntityField,
} from "../../engine/scene";
import type {
    ComponentSchemaRegistry,
    FieldSchema,
    ResourceSchema,
    SceneAssetLoader,
    SceneAssetReference,
    SceneDocument,
    SceneFieldValues,
    SceneJsonObject,
} from "../../engine/scene";
import type {
    DescribeAssetTypesResult,
    EditorFieldValue,
    EditorResourceDetails,
    EditorSettingsEntity,
    ListSettingsResult,
    SetResourceFieldRequest,
} from "../editorProtocol";
import {editorDecodeContext} from "./entityEditing";
import {componentTypeName, encodeEditorFieldValue, entitiesInCreationOrder} from "./entityInspection";

export const SETTINGS_CATEGORY = ENGINE_COMPONENT_CATEGORIES.settings;
const NO_BUILT_IN_PATHS: readonly string[] = [];

interface PresentResource {
    readonly schema: ResourceSchema;
    readonly resource: Resource;
}

function fieldsOf(resource: Resource): Record<string, unknown> {
    return resource as unknown as Record<string, unknown>;
}

function requireResourceSchema(registry: ComponentSchemaRegistry, typeName: string): ResourceSchema {
    const schema = registry.resourceByName(typeName);
    if (schema === undefined) throw new Error(`No resource type named "${typeName}" is registered`);
    return schema;
}

function requirePresentResource(world: World, registry: ComponentSchemaRegistry, typeName: string): PresentResource {
    const schema = requireResourceSchema(registry, typeName);
    const resource = world.resources.tryGet(schema.ctor);
    if (resource === undefined) throw new Error(`The world holds no ${typeName} resource`);
    return {schema, resource};
}

function requireResourceField(schema: ResourceSchema, key: string): FieldSchema {
    const field = schema.fields.find(candidate => candidate.key === key);
    if (field === undefined) throw new Error(`${schema.name} has no field "${key}"`);
    return field;
}

function dataAssetPathOrNull(resource: Resource): string | null {
    return dataAssetPathOf(resource) ?? null;
}

export function isDataAssetResource(resource: Resource): boolean {
    return dataAssetPathOf(resource) !== undefined;
}

export function describeAssetTypes(registry: ComponentSchemaRegistry): DescribeAssetTypesResult {
    return {
        assetTypes: registry.assetTypes.map(type => ({
            name: type.name,
            fileSuffixes: [...type.fileSuffixes],
            builtInPaths: [...type.builtInPaths ?? NO_BUILT_IN_PATHS],
            dataAsset: registry.resourceByName(type.name) !== undefined,
        })),
    };
}

function settingsTypeNamesOf(registry: ComponentSchemaRegistry, archetype: EntityArchetype<AnyCT>): string[] {
    return archetype.componentTypes
        .filter(type => {
            const schema = registry.byType(type);
            return schema !== undefined && categoryOf(schema) === SETTINGS_CATEGORY;
        })
        .map(type => componentTypeName(registry, type))
        .sort((a, b) => a.localeCompare(b));
}

export function listSettings(world: World, registry: ComponentSchemaRegistry): ListSettingsResult {
    const namesByArchetype = new Map<EntityArchetype<AnyCT>, readonly string[]>();
    const entities: EditorSettingsEntity[] = [];
    for (const entity of entitiesInCreationOrder(world)) {
        const archetype = getOwner(world, entity);
        if (archetype === undefined) continue;
        let names = namesByArchetype.get(archetype);
        if (names === undefined) namesByArchetype.set(archetype, names = settingsTypeNamesOf(registry, archetype));
        if (names.length === 0) continue;
        entities.push({
            entity,
            name: world.entityManager.nameOf(entity) ?? null,
            enabled: world.entityManager.isEnabled(entity),
            settingsComponentTypeNames: names,
        });
    }
    const resources = registry.resourceSchemas
        .map(schema => ({schema, resource: world.resources.tryGet(schema.ctor)}))
        .filter((entry): entry is PresentResource => entry.resource !== undefined)
        .map(({schema, resource}) => ({typeName: schema.name, dataAssetPath: dataAssetPathOrNull(resource)}));
    return {entities, resources};
}

function encodedResourceField(world: World, registry: ComponentSchemaRegistry, present: PresentResource, field: FieldSchema): EditorFieldValue {
    return encodeEditorFieldValue(world, registry, field, fieldsOf(present.resource)[field.key], `${present.schema.name}.${field.key}`);
}

export function defaultResourceFields(registry: ComponentSchemaRegistry, typeName: string): SceneJsonObject {
    return encodeDataAssetFields(registry, requireResourceSchema(registry, typeName).create());
}

export function resourceDetails(world: World, registry: ComponentSchemaRegistry, typeName: string): EditorResourceDetails {
    const present = requirePresentResource(world, registry, typeName);
    const fields: {[key: string]: EditorFieldValue} = {};
    for (const field of present.schema.fields) fields[field.key] = encodedResourceField(world, registry, present, field);
    return {typeName, dataAssetPath: dataAssetPathOrNull(present.resource), fields};
}

export function resourceFieldAssetReferences(registry: ComponentSchemaRegistry, request: SetResourceFieldRequest): SceneAssetReference[] {
    const schema = registry.resourceByName(request.typeName);
    return schema === undefined ? [] : assetReferencesOfFields(schema.fields, {[request.key]: request.value});
}

export function assignResourceField(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader, request: SetResourceFieldRequest): EditorFieldValue {
    const present = requirePresentResource(world, registry, request.typeName);
    const field = requireResourceField(present.schema, request.key);
    const path = `${request.typeName}.${request.key}`;
    const value = decodeFieldValue(field, request.value, editorDecodeContext(world, registry, assets), path);
    if (isEntityField(field) && !field.nullable && value === NULL_ENTITY) throw new Error(`${path} cannot be null`);
    assignFieldValue(present.resource, field, value);
    return encodedResourceField(world, registry, present, field);
}

export function withoutDataAssetResources(world: World, registry: ComponentSchemaRegistry, document: SceneDocument): SceneDocument {
    const resources = document.resources;
    if (resources === undefined) return document;
    const kept: {[resourceName: string]: SceneFieldValues} = {};
    let dropped = false;
    for (const name of Object.keys(resources)) {
        const schema = registry.resourceByName(name);
        const resource = schema === undefined ? undefined : world.resources.tryGet(schema.ctor);
        if (resource !== undefined && isDataAssetResource(resource)) {
            dropped = true;
            continue;
        }
        kept[name] = resources[name];
    }
    if (!dropped) return document;
    const stripped: SceneDocument = {...document};
    if (Object.keys(kept).length === 0) delete stripped.resources;
    else stripped.resources = kept;
    return stripped;
}
