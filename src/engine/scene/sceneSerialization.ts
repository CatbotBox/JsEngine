import type {Component, Entity, World} from "../core";
import {ComponentType} from "../core/componentType";
import type {EntityArchetype} from "../core/entityArchetype";
import {NULL_ENTITY} from "../core/entity";
import {getEntityCreationOrder, getOwner} from "../core/ownership";
import type {AnyCT} from "../util/tokenUtils";
import {Children} from "../translation/children";
import {Parent} from "../translation/parent";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import type {ComponentSchema, EntityFieldSchema, FieldSchema} from "./fieldSchema";
import {hasEntityFields, isEntityField} from "./fieldSchema";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {decodeFieldValue, encodeFieldValue, readSceneEntityId} from "./fieldValueCodec";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import type {SceneAssetLoader} from "./sceneAssets";
import {FIRST_SCENE_ENTITY_ID, SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION, sceneJsonEquals} from "./sceneDocument";
import type {SceneDocument, SceneEntityRecord, SceneFieldValues, SceneJsonValue} from "./sceneDocument";

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
}

export interface SceneLoadReport {
    readonly skippedComponentTypes: readonly SkippedComponentType[];
    readonly danglingEntityRefs: readonly string[];
    readonly droppedComponents: readonly string[];
}

export interface SceneLoadResult {
    readonly entities: readonly Entity[];
    readonly report: SceneLoadReport;
}

const DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY: UnknownComponentTypePolicy = "throw";
const DISABLED = false;

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
    readonly field: EntityFieldSchema;
    readonly sceneId: number | null;
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

interface DecodedField {
    readonly key: string;
    readonly value: unknown;
}

interface PreparedComponent {
    readonly planned: PlannedComponent;
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
    public readonly danglingEntityRefs: string[] = [];
    public readonly droppedComponents: string[] = [];

    public build(): SceneLoadReport {
        return {
            skippedComponentTypes: this.skipped.list(),
            danglingEntityRefs: this.danglingEntityRefs,
            droppedComponents: this.droppedComponents,
        };
    }
}

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

function ignore(): void {
}

function componentPath(index: number, componentName: string): string {
    return `entities[${index}].components.${componentName}`;
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

export function serializeWorld(world: World, registry: ComponentSchemaRegistry): SerializedScene {
    const rows = entityRowsInCreationOrder(world);
    const sceneIdByEntity = new Map<Entity, number>();
    rows.forEach((row, index) => sceneIdByEntity.set(row.entity, index + FIRST_SCENE_ENTITY_ID));

    const skipped = new SkippedTypeCounter();
    const danglingEntityRefs: string[] = [];
    const unsavedAssets: string[] = [];
    const context: FieldEncodeContext = {
        sceneIdOf: entity => sceneIdByEntity.get(entity),
        reportDanglingEntity: path => danglingEntityRefs.push(path),
        reportUnsavedAsset: path => unsavedAssets.push(path),
        inlineSpriteImageEncodings: new Map<SpriteImage, string>(),
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
        return {
            id: index + FIRST_SCENE_ENTITY_ID,
            name: world.entityManager.nameOf(row.entity) ?? null,
            enabled: row.enabled,
            components,
        };
    });

    return {
        document: {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: records},
        entities: rows.map(row => row.entity),
        report: {skippedComponentTypes: skipped.list(), danglingEntityRefs, unsavedAssets},
    };
}

function planComponents(registry: ComponentSchemaRegistry, document: SceneDocument, options: SceneLoadOptions, report: LoadReportBuilder): PlannedComponent[][] {
    const policy = options.unknownComponentTypes ?? DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY;
    return document.entities.map((record, index) => {
        const planned: PlannedComponent[] = [];
        for (const componentName of Object.keys(record.components)) {
            const path = componentPath(index, componentName);
            const schema = registry.byName(componentName);
            if (schema === undefined) {
                if (policy === "skip") {
                    report.skipped.add(componentName);
                    continue;
                }
                throw new Error(`Scene document: ${path}: the component type "${componentName}" is not registered`);
            }
            if (schema.persistence === "implied") continue;
            const json = record.components[componentName];
            const unknownKeys = Object.keys(json).filter(key => !schema.fields.some(field => field.key === key));
            if (unknownKeys.length > 0) {
                throw new Error(`Scene document: ${path}: ${componentName} has no field${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map(key => JSON.stringify(key)).join(", ")}`);
            }
            const valueFields: PlannedValueField[] = [];
            const entityFields: PlannedEntityField[] = [];
            for (const field of schema.fields) {
                const value = json[field.key];
                if (value === undefined) continue;
                const fieldPath = `${path}.${field.key}`;
                if (isEntityField(field)) entityFields.push({field, sceneId: readSceneEntityId(value, fieldPath), path: fieldPath});
                else valueFields.push({field, json: value, path: fieldPath});
            }
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

function valueDecodeContext(options: SceneLoadOptions): FieldDecodeContext {
    return {
        entityOf: () => undefined,
        reportDanglingEntity: ignore,
        assets: options.assets,
        inlineSpriteImages: new Map<string, SpriteImage>(),
    };
}

function decodeValueFields(fields: readonly PlannedValueField[], context: FieldDecodeContext): DecodedField[] {
    return fields.map(planned => ({key: planned.field.key, value: decodeFieldValue(planned.field, planned.json, context, planned.path)}));
}

function prepare(planned: PlannedComponent, context: FieldDecodeContext): PreparedComponent {
    return {planned, values: decodeValueFields(planned.valueFields, context)};
}

function instantiate(prepared: PreparedComponent): Component {
    const component = prepared.planned.schema.create();
    const fields = fieldsOf(component);
    for (const {key, value} of prepared.values) fields[key] = value;
    return component;
}

function referenceContext(document: SceneDocument, entities: readonly Entity[], report: LoadReportBuilder): FieldDecodeContext {
    const indexBySceneId = new Map<number, number>();
    document.entities.forEach((record, index) => indexBySceneId.set(record.id, index));
    return {
        entityOf: sceneId => {
            const index = indexBySceneId.get(sceneId);
            return index === undefined ? undefined : entities[index];
        },
        reportDanglingEntity: path => report.danglingEntityRefs.push(path),
    };
}

function decodeEntityFields(planned: PlannedComponent, context: FieldDecodeContext): DecodedField[] {
    return planned.entityFields.map(reference => ({
        key: reference.field.key,
        value: decodeFieldValue(reference.field, reference.sceneId, context, reference.path),
    }));
}

function missesRequiredEntity(schema: ComponentSchema, component: Component): boolean {
    const fields = fieldsOf(component);
    return schema.fields.some(field => isEntityField(field) && !field.nullable && fields[field.key] === NULL_ENTITY);
}

function instantiateReferring(prepared: PreparedComponent, context: FieldDecodeContext, report: LoadReportBuilder): Component | undefined {
    const component = instantiate(prepared);
    const fields = fieldsOf(component);
    for (const {key, value} of decodeEntityFields(prepared.planned, context)) fields[key] = value;
    if (!missesRequiredEntity(prepared.planned.schema, component)) return component;
    report.droppedComponents.push(prepared.planned.path);
    return undefined;
}

export function deserializeInto(world: World, registry: ComponentSchemaRegistry, document: SceneDocument, options: SceneLoadOptions = {}): SceneLoadResult {
    const entityManager = world.entityManager;
    const report = new LoadReportBuilder();
    const valueContext = valueDecodeContext(options);
    const prepared = planComponents(registry, document, options, report)
        .map(components => components.map(planned => prepare(planned, valueContext)));

    const entities = document.entities.map((record, index) => entityManager.createEntity(
        record.name ?? undefined,
        prepared[index].filter(component => !component.planned.refersToEntities).map(instantiate),
    ));

    const references = referenceContext(document, entities, report);
    prepared.forEach((components, index) => {
        const referring: Component[] = [];
        for (const component of components) {
            if (!component.planned.refersToEntities) continue;
            const instance = instantiateReferring(component, references, report);
            if (instance !== undefined) referring.push(instance);
        }
        if (referring.length > 0) entityManager.addComponents(entities[index], referring);
    });

    document.entities.forEach((record, index) => {
        if (!record.enabled) entityManager.setEnabledState(entities[index], DISABLED);
    });
    return {entities, report: report.build()};
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

function entitiesNotIn(world: World, kept: ReadonlySet<Entity>): Entity[] {
    const extra: Entity[] = [];
    for (const archetype of world.archetypes.values()) {
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
    for (const {key, value} of decodeEntityFields(prepared.planned, context)) {
        if (fields[key] !== value) fields[key] = value;
    }
    if (missesRequiredEntity(prepared.planned.schema, existing)) {
        entityManager.removeComponent(entity, prepared.planned.type);
        report.droppedComponents.push(prepared.planned.path);
    }
    return undefined;
}

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
            for (const child of stale) tracked.removeChild(child);
        }
    }
}

export function applySceneInPlace(world: World, registry: ComponentSchemaRegistry, snapshot: SceneSnapshot, options: SceneLoadOptions = {}): SceneLoadResult {
    const {document} = snapshot;
    if (snapshot.entities.length !== document.entities.length) {
        throw new Error(`applySceneInPlace: the snapshot lists ${snapshot.entities.length} entities for ${document.entities.length} document entities`);
    }
    if (new Set(snapshot.entities).size !== snapshot.entities.length) throw new Error("applySceneInPlace: the snapshot lists an entity twice");
    const entityManager = world.entityManager;
    const report = new LoadReportBuilder();
    const valueContext = valueDecodeContext(options);
    const comparisonContext: FieldEncodeContext = {
        sceneIdOf: () => undefined,
        reportDanglingEntity: ignore,
        reportUnsavedAsset: ignore,
        inlineSpriteImageEncodings: new Map<SpriteImage, string>(),
    };
    const planned = planComponents(registry, document, options, report);
    const liveEntities = snapshot.entities.map(entity => entityManager.exists(entity) ? entity : undefined);
    const changes = planned.map((components, index) =>
        planInPlaceChanges(world, registry, liveEntities[index], components, valueContext, comparisonContext));

    const kept = new Set<Entity>();
    for (const entity of liveEntities) if (entity !== undefined) kept.add(entity);
    for (const extra of entitiesNotIn(world, kept)) entityManager.destroyEntity(extra);

    const entities = document.entities.map((record, index) => {
        const live = liveEntities[index];
        const entityChanges = changes[index];
        if (live === undefined) return entityManager.createEntity(record.name ?? undefined, entityChanges.additions.map(instantiate));
        for (const type of entityChanges.removals) entityManager.removeComponent(live, type);
        if (entityChanges.additions.length > 0) entityManager.addComponents(live, entityChanges.additions.map(instantiate));
        for (const change of entityChanges.fieldChanges) fieldsOf(entityManager.getComponent<Component>(live, change.type)!)[change.key] = change.value;
        return live;
    });

    const references = referenceContext(document, entities, report);
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
    });
    pruneStaleChildren(world);
    return {entities, report: report.build()};
}
