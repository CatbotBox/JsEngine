import type {Component, Entity, Resource, World} from "../core";
import {ComponentType} from "../core/componentType";
import type {EntityArchetype} from "../core/entityArchetype";
import {NULL_ENTITY} from "../core/entity";
import {getEntityCreationOrder, getOwner} from "../core/ownership";
import type {AnyCT} from "../util/tokenUtils";
import {Children} from "../translation/children";
import {Parent} from "../translation/parent";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import type {ComponentSchema, FieldSchema, ResourceSchema} from "./fieldSchema";
import {hasEntityFields, isEntityField, refersToEntities} from "./fieldSchema";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {decodeFieldValue, encodeFieldValue, readSceneEntityId} from "./fieldValueCodec";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import type {SceneAssetLoader} from "./sceneAssets";
import {FIRST_SCENE_ENTITY_ID, isSceneJsonObject, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, sceneJsonEquals} from "./sceneDocument";
import type {SceneDocument, SceneEntityRecord, SceneFieldValues, SceneJsonValue} from "./sceneDocument";
import {EditorOnly} from "./editorOnly";
import {childEntitiesOf, orderedSceneRoots, parentEntityOf, setSceneRootOrder, siblingOrderOf} from "./sceneHierarchy";
import {DEFAULT_SCHEMA_CHANGE_POLICY, SchemaChangeCollector} from "./schemaChanges";
import type {SchemaChange, SchemaChangePolicy} from "./schemaChanges";
import {unregisteredTypeMessage} from "./unregisteredType";

export type {SchemaChange, SchemaChangePolicy} from "./schemaChanges";

export interface SkippedComponentType {
    readonly typeName: string;
    readonly entityCount: number;
}

export interface SceneSaveReport {
    readonly skippedComponentTypes: readonly SkippedComponentType[];
    readonly danglingEntityRefs: readonly string[];
    readonly unsavedAssets: readonly string[];
}

export interface SceneSnapshot {
    readonly document: SceneDocument;
    readonly entities: readonly Entity[];
}

export interface SerializedScene extends SceneSnapshot {
    readonly report: SceneSaveReport;
}

export type UnknownComponentTypePolicy = "throw" | "skip";

export interface SceneLoadOptions {
    readonly assets?: SceneAssetLoader;
    readonly unknownComponentTypes?: UnknownComponentTypePolicy;
    readonly schemaChanges?: SchemaChangePolicy;
}

export interface SceneLoadReport {
    readonly skippedComponentTypes: readonly SkippedComponentType[];
    readonly skippedResourceTypes: readonly string[];
    readonly danglingEntityRefs: readonly string[];
    readonly droppedComponents: readonly string[];
    readonly changedSchemas: readonly SchemaChange[];
}

export interface SceneLoadResult {
    readonly entities: readonly Entity[];
    readonly report: SceneLoadReport;
}

export interface InstantiateOptions extends SceneLoadOptions {
    readonly parent?: Entity | null;
    readonly siblingIndex?: number;
}

export interface InstantiatedDocument extends SceneLoadResult {
    readonly roots: readonly Entity[];
}

export const PARENT_COMPONENT_NAME = "Parent";
export const PARENT_ENTITY_KEY = "entity";

const DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY: UnknownComponentTypePolicy = "throw";
const DISABLED = false;
const UNORDERED_SIBLING = Number.POSITIVE_INFINITY;

interface EntityRow {
    readonly entity: Entity;
    readonly enabled: boolean;
    readonly archetype: EntityArchetype<AnyCT>;
    readonly row: number;
}

interface PlannedValueField {
    readonly field: FieldSchema;
    readonly json: SceneJsonValue;
    readonly path: string;
}

interface PlannedEntityField {
    readonly field: FieldSchema;
    readonly json: SceneJsonValue;
    readonly path: string;
}

interface PlannedComponent {
    readonly schema: ComponentSchema;
    readonly type: AnyCT;
    readonly path: string;
    readonly refersToEntities: boolean;
    readonly valueFields: readonly PlannedValueField[];
    readonly entityFields: readonly PlannedEntityField[];
}

interface PlannedResource {
    readonly schema: ResourceSchema;
    readonly path: string;
    readonly valueFields: readonly PlannedValueField[];
    readonly entityFields: readonly PlannedEntityField[];
}

interface DecodedField {
    readonly key: string;
    readonly value: unknown;
}

interface PreparedComponent {
    readonly planned: PlannedComponent;
    readonly values: readonly DecodedField[];
}

interface PreparedResource {
    readonly planned: PlannedResource;
    readonly values: readonly DecodedField[];
}

interface FieldChange {
    readonly type: AnyCT;
    readonly key: string;
    readonly value: unknown;
}

interface InPlaceChanges {
    readonly removals: AnyCT[];
    readonly additions: PreparedComponent[];
    readonly fieldChanges: FieldChange[];
    readonly referringComponents: PreparedComponent[];
}

interface SerializedRows {
    readonly records: SceneEntityRecord[];
    readonly entities: Entity[];
    readonly sceneIdByEntity: ReadonlyMap<Entity, number>;
    readonly context: FieldEncodeContext;
    readonly skipped: SkippedTypeCounter;
    readonly danglingEntityRefs: string[];
    readonly unsavedAssets: string[];
}

interface DocumentHierarchy {
    readonly childrenByParentIndex: ReadonlyMap<number, readonly number[]>;
    readonly rootIndices: readonly number[];
}

class SkippedTypeCounter {
    private readonly counts = new Map<string, number>();

    public add(typeName: string): void {
        this.counts.set(typeName, (this.counts.get(typeName) ?? 0) + 1);
    }

    public list(): SkippedComponentType[] {
        return [...this.counts.keys()].sort().map(typeName => ({typeName, entityCount: this.counts.get(typeName)!}));
    }
}

class LoadReportBuilder {
    public readonly skipped = new SkippedTypeCounter();
    public readonly skippedResources = new Set<string>();
    public readonly danglingEntityRefs: string[] = [];
    public readonly droppedComponents: string[] = [];
    public readonly schemaChanges = new SchemaChangeCollector();

    public build(): SceneLoadReport {
        return {
            skippedComponentTypes: this.skipped.list(),
            skippedResourceTypes: [...this.skippedResources].sort(),
            danglingEntityRefs: this.danglingEntityRefs,
            droppedComponents: this.droppedComponents,
            changedSchemas: this.schemaChanges.list(),
        };
    }
}

function fieldsOf(target: Component | Resource): Record<string, unknown> {
    return target as unknown as Record<string, unknown>;
}

function ignore(): void {
}

function componentPath(index: number, componentName: string): string {
    return `entities[${index}].components.${componentName}`;
}

function resourcePath(resourceName: string): string {
    return `resources.${resourceName}`;
}

function isEditorOnlyArchetype(archetype: EntityArchetype<AnyCT>): boolean {
    return archetype.getColumn(ComponentType.of(EditorOnly)) !== undefined;
}

function sceneRowsInCreationOrder(world: World): EntityRow[] {
    const rows: EntityRow[] = [];
    for (const archetype of world.archetypes.values()) {
        if (isEditorOnlyArchetype(archetype)) continue;
        const count = archetype.entityCountIncludingDisabled;
        for (let row = 0; row < count; row++) {
            rows.push({entity: archetype.getEntityAtIndex(row), enabled: archetype.isEntityIndexEnabled(row), archetype, row});
        }
    }
    return rows.sort((a, b) => getEntityCreationOrder(a.entity)! - getEntityCreationOrder(b.entity)!);
}

export function isSceneEntity(world: World, entity: Entity): boolean {
    const archetype = getOwner(world, entity);
    return archetype !== undefined && !isEditorOnlyArchetype(archetype);
}

export function sceneEntitiesInCreationOrder(world: World): Entity[] {
    return sceneRowsInCreationOrder(world).map(row => row.entity);
}

function savesHierarchy(registry: ComponentSchemaRegistry): boolean {
    const schema = registry.byType(ComponentType.of(Parent));
    return schema !== undefined && schema.persistence === "fields";
}

function sameOrder(a: readonly Entity[], b: readonly Entity[]): boolean {
    return a.length === b.length && a.every((entity, index) => entity === b[index]);
}

function siblingIndicesToSave(world: World, registry: ComponentSchemaRegistry, entities: readonly Entity[], explicitRootOrder?: readonly Entity[]): Map<Entity, number> {
    const saved = new Map<Entity, number>();
    if (!savesHierarchy(registry)) return saved;
    const order = siblingOrderOf(world, entities, explicitRootOrder);
    const documentIndex = new Map<Entity, number>();
    entities.forEach((entity, index) => documentIndex.set(entity, index));
    const byDocumentOrder = (group: readonly Entity[]) => [...group].sort((a, b) => documentIndex.get(a)! - documentIndex.get(b)!);
    const recordGroup = (group: readonly Entity[]) => {
        if (sameOrder(group, byDocumentOrder(group))) return;
        group.forEach((entity, index) => saved.set(entity, index));
    };
    recordGroup(order.roots);
    for (const children of order.childrenOf.values()) recordGroup(children);
    return saved;
}

function serializeRows(world: World, registry: ComponentSchemaRegistry, rows: readonly EntityRow[], explicitRootOrder?: readonly Entity[]): SerializedRows {
    const entities = rows.map(row => row.entity);
    const sceneIdByEntity = new Map<Entity, number>();
    entities.forEach((entity, index) => sceneIdByEntity.set(entity, index + FIRST_SCENE_ENTITY_ID));
    const siblingIndices = siblingIndicesToSave(world, registry, entities, explicitRootOrder);

    const skipped = new SkippedTypeCounter();
    const danglingEntityRefs: string[] = [];
    const unsavedAssets: string[] = [];
    const context: FieldEncodeContext = {
        sceneIdOf: entity => sceneIdByEntity.get(entity),
        reportDanglingEntity: path => danglingEntityRefs.push(path),
        reportUnsavedAsset: path => unsavedAssets.push(path),
        inlineSpriteImageEncodings: new Map<SpriteImage, string>(),
        fieldTypes: registry,
    };

    const records = rows.map((row, index): SceneEntityRecord => {
        const saved: {schema: ComponentSchema, type: AnyCT}[] = [];
        for (const type of row.archetype.componentTypes) {
            const schema = registry.byType(type);
            if (schema === undefined) skipped.add(type.ctor.name);
            else if (schema.persistence !== "implied") saved.push({schema, type});
        }
        saved.sort((a, b) => registry.indexOf(a.schema) - registry.indexOf(b.schema));

        const components: {[componentName: string]: SceneFieldValues} = {};
        for (const {schema, type} of saved) {
            const values: SceneFieldValues = {};
            if (schema.persistence === "fields") {
                const component = fieldsOf(row.archetype.getColumn(type)!.get(row.row));
                const path = componentPath(index, schema.name);
                for (const field of schema.fields) values[field.key] = encodeFieldValue(field, component[field.key], context, `${path}.${field.key}`);
            }
            components[schema.name] = values;
        }
        const id = index + FIRST_SCENE_ENTITY_ID;
        const name = world.entityManager.nameOf(row.entity) ?? null;
        const siblingIndex = siblingIndices.get(row.entity);
        return siblingIndex === undefined
            ? {id, name, enabled: row.enabled, components}
            : {id, name, enabled: row.enabled, siblingIndex, components};
    });
    return {records, entities, sceneIdByEntity, context, skipped, danglingEntityRefs, unsavedAssets};
}

function serializeResources(world: World, registry: ComponentSchemaRegistry, context: FieldEncodeContext): {[resourceName: string]: SceneFieldValues} | undefined {
    let resources: {[resourceName: string]: SceneFieldValues} | undefined;
    for (const schema of registry.resourceSchemas) {
        const resource = world.resources.tryGet(schema.ctor);
        if (resource === undefined) continue;
        const values: SceneFieldValues = {};
        const current = fieldsOf(resource);
        for (const field of schema.fields) values[field.key] = encodeFieldValue(field, current[field.key], context, `${resourcePath(schema.name)}.${field.key}`);
        (resources ??= {})[schema.name] = values;
    }
    return resources;
}

export function serializeWorld(world: World, registry: ComponentSchemaRegistry): SerializedScene {
    const serialized = serializeRows(world, registry, sceneRowsInCreationOrder(world));
    const document: SceneDocument = {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: serialized.records};
    const resources = serializeResources(world, registry, serialized.context);
    if (resources !== undefined) document.resources = resources;
    return {
        document,
        entities: serialized.entities,
        report: {skippedComponentTypes: serialized.skipped.list(), danglingEntityRefs: serialized.danglingEntityRefs, unsavedAssets: serialized.unsavedAssets},
    };
}

function linkedChildrenByParent(world: World, rows: readonly EntityRow[]): Map<Entity, Entity[]> {
    const parentType = ComponentType.of(Parent);
    const byParent = new Map<Entity, Entity[]>();
    for (const row of rows) {
        const link = row.archetype.getColumn(parentType)?.get(row.row) as Parent | undefined;
        if (link === undefined || link.entity === row.entity) continue;
        let children = byParent.get(link.entity);
        if (children === undefined) byParent.set(link.entity, children = []);
        children.push(row.entity);
    }
    for (const row of rows) {
        for (const child of childEntitiesOf(world, row.entity)) {
            let children = byParent.get(row.entity);
            if (children === undefined) byParent.set(row.entity, children = []);
            if (!children.includes(child)) children.push(child);
        }
    }
    return byParent;
}

export function serializeEntities(world: World, registry: ComponentSchemaRegistry, roots: readonly Entity[]): SerializedScene {
    for (const root of roots) {
        if (!isSceneEntity(world, root)) throw new Error(`serializeEntities: entity ${root} is not a scene entity of this world`);
    }
    const allRows = sceneRowsInCreationOrder(world);
    const rowByEntity = new Map<Entity, EntityRow>();
    for (const row of allRows) rowByEntity.set(row.entity, row);
    const linkedChildren = linkedChildrenByParent(world, allRows);
    const included = new Set<Entity>();
    const queue: Entity[] = [];
    for (const root of roots) {
        if (included.has(root)) continue;
        included.add(root);
        queue.push(root);
    }
    for (let i = 0; i < queue.length; i++) {
        for (const child of linkedChildren.get(queue[i]) ?? []) {
            if (included.has(child) || !rowByEntity.has(child)) continue;
            included.add(child);
            queue.push(child);
        }
    }
    const rows = allRows.filter(row => included.has(row.entity));
    const documentRoots = roots.filter(root => {
        const parent = parentEntityOf(world, root);
        return parent === undefined || !included.has(parent);
    });
    const serialized = serializeRows(world, registry, rows, documentRoots);
    const rootParentPaths = new Set(documentRoots.map(root => {
        const index = serialized.entities.indexOf(root);
        return `${componentPath(index, registry.byType(ComponentType.of(Parent))?.name ?? PARENT_COMPONENT_NAME)}.${PARENT_ENTITY_KEY}`;
    }));
    return {
        document: {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: serialized.records},
        entities: serialized.entities,
        report: {
            skippedComponentTypes: serialized.skipped.list(),
            danglingEntityRefs: serialized.danglingEntityRefs.filter(path => !rootParentPaths.has(path)),
            unsavedAssets: serialized.unsavedAssets,
        },
    };
}

function planFieldGroup(
    typeName: string,
    fields: readonly FieldSchema[],
    json: SceneFieldValues,
    path: string,
    options: SceneLoadOptions,
    report: LoadReportBuilder,
    validation: FieldDecodeContext,
): {valueFields: PlannedValueField[], entityFields: PlannedEntityField[]} {
    const policy = options.schemaChanges ?? DEFAULT_SCHEMA_CHANGE_POLICY;
    const unknownKeys = Object.keys(json).filter(key => !fields.some(field => field.key === key));
    if (policy === "strict" && unknownKeys.length > 0) {
        throw new Error(`Scene document: ${path}: ${typeName} has no field${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map(key => JSON.stringify(key)).join(", ")}`);
    }
    if (policy === "report") report.schemaChanges.add(typeName, fields.filter(field => json[field.key] === undefined).map(field => field.key), unknownKeys);
    const valueFields: PlannedValueField[] = [];
    const entityFields: PlannedEntityField[] = [];
    for (const field of fields) {
        const value = json[field.key];
        if (value === undefined) continue;
        const fieldPath = `${path}.${field.key}`;
        if (!refersToEntities(field)) {
            valueFields.push({field, json: value, path: fieldPath});
            continue;
        }
        if (isEntityField(field)) readSceneEntityId(value, fieldPath);
        else decodeFieldValue(field, value, validation, fieldPath);
        entityFields.push({field, json: value, path: fieldPath});
    }
    return {valueFields, entityFields};
}

function planComponents(registry: ComponentSchemaRegistry, document: SceneDocument, options: SceneLoadOptions, report: LoadReportBuilder): PlannedComponent[][] {
    const policy = options.unknownComponentTypes ?? DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY;
    const validation = valueDecodeContext(registry, options, report);
    return document.entities.map((record, index) => {
        const planned: PlannedComponent[] = [];
        for (const componentName of Object.keys(record.components)) {
            const path = componentPath(index, componentName);
            const schema = registry.byName(componentName);
            if (schema === undefined) {
                if (registry.isOtherBackendTypeName(componentName)) continue;
                if (policy === "skip") {
                    report.skipped.add(componentName);
                    continue;
                }
                throw new Error(`Scene document: ${path}: ${unregisteredTypeMessage("component", componentName)}`);
            }
            if (schema.persistence === "implied") continue;
            const {valueFields, entityFields} = planFieldGroup(componentName, schema.fields, record.components[componentName], path, options, report, validation);
            planned.push({
                schema,
                type: ComponentType.of(schema.ctor),
                path,
                refersToEntities: hasEntityFields(schema),
                valueFields,
                entityFields,
            });
        }
        return planned;
    });
}

function planResources(registry: ComponentSchemaRegistry, document: SceneDocument, options: SceneLoadOptions, report: LoadReportBuilder): PlannedResource[] {
    const resources = document.resources;
    if (resources === undefined) return [];
    const policy = options.unknownComponentTypes ?? DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY;
    const validation = valueDecodeContext(registry, options, report);
    const planned: PlannedResource[] = [];
    for (const resourceName of Object.keys(resources)) {
        const path = resourcePath(resourceName);
        const schema = registry.resourceByName(resourceName);
        if (schema === undefined) {
            if (registry.isOtherBackendTypeName(resourceName)) continue;
            if (policy === "skip") {
                report.skippedResources.add(resourceName);
                continue;
            }
            throw new Error(`Scene document: ${path}: ${unregisteredTypeMessage("resource", resourceName)}`);
        }
        const {valueFields, entityFields} = planFieldGroup(resourceName, schema.fields, resources[resourceName], path, options, report, validation);
        planned.push({schema, path, valueFields, entityFields});
    }
    return planned;
}

function valueDecodeContext(registry: ComponentSchemaRegistry, options: SceneLoadOptions, report: LoadReportBuilder): FieldDecodeContext {
    const context: FieldDecodeContext = {
        entityOf: () => undefined,
        reportDanglingEntity: ignore,
        assets: options.assets,
        inlineSpriteImages: new Map<string, SpriteImage>(),
        fieldTypes: registry,
    };
    const reportsSchemaChanges = (options.schemaChanges ?? DEFAULT_SCHEMA_CHANGE_POLICY) === "report";
    if (!reportsSchemaChanges) return context;
    return {...context, reportSchemaChange: (typeName, addedKeys, removedKeys) => report.schemaChanges.add(typeName, addedKeys, removedKeys)};
}

function decodeValueFields(fields: readonly PlannedValueField[], context: FieldDecodeContext): DecodedField[] {
    return fields.map(planned => ({key: planned.field.key, value: decodeFieldValue(planned.field, planned.json, context, planned.path)}));
}

function prepare(planned: PlannedComponent, context: FieldDecodeContext): PreparedComponent {
    return {planned, values: decodeValueFields(planned.valueFields, context)};
}

function prepareResource(planned: PlannedResource, context: FieldDecodeContext): PreparedResource {
    return {planned, values: decodeValueFields(planned.valueFields, context)};
}

function instantiate(prepared: PreparedComponent): Component {
    const component = prepared.planned.schema.create();
    const fields = fieldsOf(component);
    for (const {key, value} of prepared.values) fields[key] = value;
    return component;
}

function referenceContext(document: SceneDocument, entities: readonly Entity[], report: LoadReportBuilder, values: FieldDecodeContext): FieldDecodeContext {
    const indexBySceneId = new Map<number, number>();
    document.entities.forEach((record, index) => indexBySceneId.set(record.id, index));
    return {
        ...values,
        entityOf: sceneId => {
            const index = indexBySceneId.get(sceneId);
            return index === undefined ? undefined : entities[index];
        },
        reportDanglingEntity: path => report.danglingEntityRefs.push(path),
    };
}

function decodeEntityFields(fields: readonly PlannedEntityField[], context: FieldDecodeContext): DecodedField[] {
    return fields.map(reference => ({
        key: reference.field.key,
        value: decodeFieldValue(reference.field, reference.json, context, reference.path),
    }));
}

function missesRequiredEntity(schema: ComponentSchema, component: Component): boolean {
    const fields = fieldsOf(component);
    return schema.fields.some(field => isEntityField(field) && !field.nullable && fields[field.key] === NULL_ENTITY);
}

function instantiateReferring(prepared: PreparedComponent, context: FieldDecodeContext, report: LoadReportBuilder): Component | undefined {
    const component = instantiate(prepared);
    const fields = fieldsOf(component);
    for (const {key, value} of decodeEntityFields(prepared.planned.entityFields, context)) fields[key] = value;
    if (!missesRequiredEntity(prepared.planned.schema, component)) return component;
    report.droppedComponents.push(prepared.planned.path);
    return undefined;
}

function siblingRank(document: SceneDocument, index: number): number {
    return document.entities[index].siblingIndex ?? UNORDERED_SIBLING;
}

function bySiblingOrder(document: SceneDocument): (a: number, b: number) => number {
    return (a, b) => (siblingRank(document, a) - siblingRank(document, b)) || (a - b);
}

function loadedHierarchy(world: World, document: SceneDocument, entities: readonly Entity[]): DocumentHierarchy {
    const indexByEntity = new Map<Entity, number>();
    entities.forEach((entity, index) => indexByEntity.set(entity, index));
    const childrenByParentIndex = new Map<number, number[]>();
    const rootIndices: number[] = [];
    entities.forEach((entity, index) => {
        const parent = parentEntityOf(world, entity);
        const parentIndex = parent === undefined ? undefined : indexByEntity.get(parent);
        if (parentIndex === undefined) {
            rootIndices.push(index);
            return;
        }
        let children = childrenByParentIndex.get(parentIndex);
        if (children === undefined) childrenByParentIndex.set(parentIndex, children = []);
        children.push(index);
    });
    const order = bySiblingOrder(document);
    for (const children of childrenByParentIndex.values()) children.sort(order);
    rootIndices.sort(order);
    return {childrenByParentIndex, rootIndices};
}

function childrenComponentOf(world: World, parent: Entity): Children {
    const entityManager = world.entityManager;
    const existing = entityManager.getComponent<Children>(parent, Children);
    if (existing !== undefined) return existing;
    entityManager.addComponent(parent, new Children());
    return entityManager.getComponent<Children>(parent, Children)!;
}

function orderChildren(world: World, hierarchy: DocumentHierarchy, entities: readonly Entity[]): void {
    for (const [parentIndex, childIndices] of hierarchy.childrenByParentIndex) {
        const children = childrenComponentOf(world, entities[parentIndex]);
        childIndices.forEach((childIndex, rank) => {
            if (children.indexOf(entities[childIndex]) !== rank) children.insertChild(entities[childIndex], rank);
        });
    }
}

function sceneRootsInCreationOrder(world: World): Entity[] {
    return sceneEntitiesInCreationOrder(world).filter(entity => parentEntityOf(world, entity) === undefined);
}

function placeRoots(world: World, roots: readonly Entity[], index: number | undefined): void {
    const placed = new Set(roots);
    const others = orderedSceneRoots(world, sceneRootsInCreationOrder(world)).filter(root => !placed.has(root));
    const at = index === undefined ? others.length : Math.max(0, Math.min(index, others.length));
    setSceneRootOrder(world, [...others.slice(0, at), ...roots, ...others.slice(at)]);
}

function rootsHaveSiblingIndex(document: SceneDocument, rootIndices: readonly number[]): boolean {
    return rootIndices.some(index => document.entities[index].siblingIndex !== undefined);
}

interface CreatedDocumentEntities {
    readonly entities: Entity[];
    readonly hierarchy: DocumentHierarchy;
}

function createDocumentEntities(
    world: World,
    registry: ComponentSchemaRegistry,
    document: SceneDocument,
    planned: readonly PlannedComponent[][],
    options: SceneLoadOptions,
    report: LoadReportBuilder,
): CreatedDocumentEntities {
    const entityManager = world.entityManager;
    const valueContext = valueDecodeContext(registry, options, report);
    const prepared = planned.map(components => components.map(component => prepare(component, valueContext)));

    const entities = document.entities.map((record, index) => entityManager.createEntity(
        record.name ?? undefined,
        prepared[index].filter(component => !component.planned.refersToEntities).map(instantiate),
    ));

    // Second pass: entity-referencing components (Parent.setup adds Children to its target) need every entity to exist.
    const references = referenceContext(document, entities, report, valueContext);
    prepared.forEach((components, index) => {
        const referring: Component[] = [];
        for (const component of components) {
            if (!component.planned.refersToEntities) continue;
            const instance = instantiateReferring(component, references, report);
            if (instance !== undefined) referring.push(instance);
        }
        if (referring.length > 0) entityManager.addComponents(entities[index], referring);
    });

    const hierarchy = loadedHierarchy(world, document, entities);
    orderChildren(world, hierarchy, entities);
    document.entities.forEach((record, index) => {
        if (!record.enabled) entityManager.setEnabledState(entities[index], DISABLED);
    });
    return {entities, hierarchy};
}

function assignResourceFields(world: World, prepared: PreparedResource, references: FieldDecodeContext, comparison: FieldEncodeContext | undefined): void {
    const schema = prepared.planned.schema;
    const resource = world.resources.tryGet(schema.ctor) ?? world.resources.insert(schema.create());
    const current = fieldsOf(resource);
    const fieldByKey = new Map(schema.fields.map(field => [field.key, field]));
    const jsonByKey = new Map(prepared.planned.valueFields.map(field => [field.field.key, field]));
    for (const {key, value} of prepared.values) {
        const planned = jsonByKey.get(key)!;
        if (comparison !== undefined && encodesTo(fieldByKey.get(key)!, current[key], planned.json, comparison, planned.path)) continue;
        current[key] = value;
    }
    for (const {key, value} of decodeEntityFields(prepared.planned.entityFields, references)) {
        if (current[key] !== value) current[key] = value;
    }
}

export function deserializeInto(world: World, registry: ComponentSchemaRegistry, document: SceneDocument, options: SceneLoadOptions = {}): SceneLoadResult {
    const report = new LoadReportBuilder();
    const planned = planComponents(registry, document, options, report);
    const resourceContext = valueDecodeContext(registry, options, report);
    const preparedResources = planResources(registry, document, options, report).map(resource => prepareResource(resource, resourceContext));
    const created = createDocumentEntities(world, registry, document, planned, options, report);
    const rootEntities = created.hierarchy.rootIndices.map(index => created.entities[index]);
    if (rootsHaveSiblingIndex(document, created.hierarchy.rootIndices)) placeRoots(world, rootEntities, undefined);
    const references = referenceContext(document, created.entities, report, resourceContext);
    for (const resource of preparedResources) assignResourceFields(world, resource, references, undefined);
    return {entities: created.entities, report: report.build()};
}

export function withoutDetachedParents(registry: ComponentSchemaRegistry, document: SceneDocument): SceneDocument {
    const parentName = registry.byType(ComponentType.of(Parent))?.name ?? PARENT_COMPONENT_NAME;
    const ids = new Set(document.entities.map(record => record.id));
    const entities = document.entities.map(record => {
        const link = record.components[parentName];
        if (link === undefined) return record;
        const target = isSceneJsonObject(link) ? link[PARENT_ENTITY_KEY] : undefined;
        if (typeof target === "number" && ids.has(target)) return record;
        const components = {...record.components};
        delete components[parentName];
        return {...record, components};
    });
    return {...document, entities};
}

export function instantiateDocument(world: World, registry: ComponentSchemaRegistry, document: SceneDocument, options: InstantiateOptions = {}): InstantiatedDocument {
    const parent = options.parent ?? undefined;
    if (parent !== undefined && !world.entityManager.exists(parent)) throw new Error(`instantiateDocument: the parent entity ${parent} does not exist`);
    const placed = withoutDetachedParents(registry, document);
    const report = new LoadReportBuilder();
    const planned = planComponents(registry, placed, options, report);
    const created = createDocumentEntities(world, registry, placed, planned, options, report);
    const roots = created.hierarchy.rootIndices.map(index => created.entities[index]);
    if (parent !== undefined) {
        const entityManager = world.entityManager;
        roots.forEach((root, offset) => {
            entityManager.addComponent(root, new Parent(parent));
            const children = childrenComponentOf(world, parent);
            const index = options.siblingIndex === undefined ? children.children.length : options.siblingIndex + offset;
            children.insertChild(root, index);
        });
    } else if (options.siblingIndex !== undefined || rootsHaveSiblingIndex(placed, created.hierarchy.rootIndices)) {
        placeRoots(world, roots, options.siblingIndex);
    }
    return {entities: created.entities, roots, report: report.build()};
}

function encodesTo(field: FieldSchema, current: unknown, json: SceneJsonValue, context: FieldEncodeContext, path: string): boolean {
    try {
        return sceneJsonEquals(encodeFieldValue(field, current, context, path), json);
    } catch {
        return false;
    }
}

function planInPlaceChanges(
    world: World,
    registry: ComponentSchemaRegistry,
    entity: Entity | undefined,
    planned: readonly PlannedComponent[],
    valueContext: FieldDecodeContext,
    comparisonContext: FieldEncodeContext,
): InPlaceChanges {
    const changes: InPlaceChanges = {removals: [], additions: [], fieldChanges: [], referringComponents: []};
    const plannedTypeIds = new Set(planned.map(component => component.type.id));
    if (entity !== undefined) {
        for (const type of getOwner(world, entity)!.componentTypes) {
            const schema = registry.byType(type);
            if (schema !== undefined && schema.persistence !== "implied" && !plannedTypeIds.has(type.id)) changes.removals.push(type);
        }
    }
    for (const component of planned) {
        const current = entity === undefined ? undefined : world.entityManager.getComponent<Component>(entity, component.type);
        if (current === undefined) {
            const prepared = prepare(component, valueContext);
            if (component.refersToEntities) changes.referringComponents.push(prepared);
            else changes.additions.push(prepared);
            continue;
        }
        const currentFields = fieldsOf(current);
        const changed = component.valueFields.filter(field =>
            !encodesTo(field.field, currentFields[field.field.key], field.json, comparisonContext, field.path));
        for (const {key, value} of decodeValueFields(changed, valueContext)) changes.fieldChanges.push({type: component.type, key, value});
        if (component.refersToEntities) changes.referringComponents.push({planned: component, values: []});
    }
    return changes;
}

function sceneEntitiesNotIn(world: World, kept: ReadonlySet<Entity>): Entity[] {
    const extra: Entity[] = [];
    for (const archetype of world.archetypes.values()) {
        if (isEditorOnlyArchetype(archetype)) continue;
        const count = archetype.entityCountIncludingDisabled;
        for (let row = 0; row < count; row++) {
            const entity = archetype.getEntityAtIndex(row);
            if (!kept.has(entity)) extra.push(entity);
        }
    }
    return extra;
}

function applyReferringComponent(world: World, entity: Entity, prepared: PreparedComponent, context: FieldDecodeContext, report: LoadReportBuilder): Component | undefined {
    const entityManager = world.entityManager;
    const existing = entityManager.getComponent<Component>(entity, prepared.planned.type);
    if (existing === undefined) return instantiateReferring(prepared, context, report);
    const fields = fieldsOf(existing);
    for (const {key, value} of decodeEntityFields(prepared.planned.entityFields, context)) {
        if (fields[key] !== value) fields[key] = value;
    }
    if (missesRequiredEntity(prepared.planned.schema, existing)) {
        entityManager.removeComponent(entity, prepared.planned.type);
        report.droppedComponents.push(prepared.planned.path);
    }
    return undefined;
}

// A Children entry whose child is gone or now has another Parent would make HierarchySyncSystem re-parent that child back.
function pruneStaleChildren(world: World): void {
    const entityManager = world.entityManager;
    const childrenType = ComponentType.of(Children);
    const parentType = ComponentType.of(Parent);
    for (const archetype of world.archetypes.values()) {
        const column = archetype.getColumn(childrenType);
        if (column === undefined) continue;
        const count = archetype.entityCountIncludingDisabled;
        for (let row = 0; row < count; row++) {
            const parent = archetype.getEntityAtIndex(row);
            const stale = (column.get(row) as Children).children.filter(child =>
                !entityManager.exists(child) || entityManager.getComponent<Parent>(child, parentType)?.entity !== parent);
            if (stale.length === 0) continue;
            const tracked = entityManager.getComponent<Children>(parent, childrenType)!;
            for (const child of stale) tracked.removeChildKeepingOrder(child);
        }
    }
}

export function applySceneInPlace(world: World, registry: ComponentSchemaRegistry, snapshot: SceneSnapshot, options: SceneLoadOptions = {}): SceneLoadResult {
    const {document} = snapshot;
    if (snapshot.entities.length !== document.entities.length) {
        throw new Error(`applySceneInPlace: the snapshot lists ${snapshot.entities.length} entities for ${document.entities.length} document entities`);
    }
    const entityManager = world.entityManager;
    const liveEntities = snapshot.entities.map(entity => entityManager.exists(entity) ? entity : undefined);
    const live = liveEntities.filter((entity): entity is Entity => entity !== undefined);
    if (new Set(live).size !== live.length) throw new Error("applySceneInPlace: the snapshot lists an entity twice");
    const report = new LoadReportBuilder();
    const valueContext = valueDecodeContext(registry, options, report);
    const comparisonContext: FieldEncodeContext = {
        sceneIdOf: () => undefined,
        reportDanglingEntity: ignore,
        reportUnsavedAsset: ignore,
        inlineSpriteImageEncodings: new Map<SpriteImage, string>(),
        fieldTypes: registry,
    };
    const planned = planComponents(registry, document, options, report);
    const preparedResources = planResources(registry, document, options, report).map(resource => prepareResource(resource, valueContext));
    const changes = planned.map((components, index) =>
        planInPlaceChanges(world, registry, liveEntities[index], components, valueContext, comparisonContext));

    const kept = new Set<Entity>(live);
    for (const extra of sceneEntitiesNotIn(world, kept)) entityManager.destroyEntity(extra);

    const entities = document.entities.map((record, index) => {
        const existing = liveEntities[index];
        const entityChanges = changes[index];
        if (existing === undefined) return entityManager.createEntity(record.name ?? undefined, entityChanges.additions.map(instantiate));
        for (const type of entityChanges.removals) entityManager.removeComponent(existing, type);
        if (entityChanges.additions.length > 0) entityManager.addComponents(existing, entityChanges.additions.map(instantiate));
        for (const change of entityChanges.fieldChanges) fieldsOf(entityManager.getComponent<Component>(existing, change.type)!)[change.key] = change.value;
        return existing;
    });

    const references = referenceContext(document, entities, report, valueContext);
    changes.forEach((entityChanges, index) => {
        const added: Component[] = [];
        for (const prepared of entityChanges.referringComponents) {
            const instance = applyReferringComponent(world, entities[index], prepared, references, report);
            if (instance !== undefined) added.push(instance);
        }
        if (added.length > 0) entityManager.addComponents(entities[index], added);
    });

    document.entities.forEach((record, index) => {
        if (entityManager.isEnabled(entities[index]) !== record.enabled) entityManager.setEnabledState(entities[index], record.enabled);
        if ((entityManager.nameOf(entities[index]) ?? null) !== record.name) entityManager.setName(entities[index], record.name ?? undefined);
    });
    pruneStaleChildren(world);
    const hierarchy = loadedHierarchy(world, document, entities);
    orderChildren(world, hierarchy, entities);
    setSceneRootOrder(world, hierarchy.rootIndices.map(index => entities[index]));
    for (const resource of preparedResources) assignResourceFields(world, resource, references, comparisonContext);
    return {entities, report: report.build()};
}
