import {World} from "../../engine/core";
import type {Component, Entity} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import {NULL_ENTITY} from "../../engine/core/entity";
import {getOwner} from "../../engine/core/ownership";
import {Parent} from "../../engine/translation/parent";
import {
    decodeFieldValue,
    encodeFieldValue,
    instantiateDocument,
    isEntityField,
    PARENT_COMPONENT_NAME,
    PrefabInstance,
    sceneEntitiesInCreationOrder,
    sceneJsonEquals,
    serializeEntities,
    untrackedComponentOf,
    withoutSceneMembership,
} from "../../engine/scene";
import type {
    ComponentSchema,
    ComponentSchemaRegistry,
    FieldDecodeContext,
    FieldEncodeContext,
    InstantiatedDocument,
    SceneAssetLoader,
    SceneDocument,
    SceneEntityRecord,
    SceneFieldValues,
} from "../../engine/scene";
import type {PrefabOverridesResult} from "../editorProtocol";
import {parentOf, requireSceneEntity} from "./entityInspection";
import {destroyWithDescendants, renameEntity, setEntityEnabled} from "./entityEditing";
import {
    componentOverridePath,
    diffPrefabOverrides,
    documentTree,
    ENTITY_ENABLED_PROPERTY,
    ENTITY_NAME_PROPERTY,
    entityPathsOf,
    entityPropertyPath,
    fieldOverridePath,
    childEntityPath,
    isComparedComponent,
    PREFAB_INSTANCE_COMPONENT_NAME,
    ROOT_DEFAULT_OVERRIDE_TYPES,
    ROOT_ENTITY_PATH,
    subtreeDocument,
    subtreeRecordIndices,
} from "./prefabOverrides";
import type {DocumentTree} from "./prefabOverrides";
import {childrenComponent} from "./hierarchyEditing";

const SKIPPED_UNKNOWN_TYPES = "skip";
const REPORTED_SCHEMA_CHANGES = "report";

interface PrefabSync {
    readonly prefab: SceneDocument;
    readonly tree: DocumentTree;
    readonly paths: ReadonlyMap<number, string>;
    readonly kept: ReadonlySet<string>;
    readonly matched: Map<number, Entity>;
    readonly created: Set<Entity>;
}

function ignore(): void {
}

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

function withoutInstanceData(document: SceneDocument): SceneDocument {
    const root = documentTree(document).roots[0];
    const entities = withoutSceneMembership(document).entities.map((record, index): SceneEntityRecord => {
        if (index !== root) return record;
        const components = {...record.components};
        delete components[PREFAB_INSTANCE_COMPONENT_NAME];
        delete components[PARENT_COMPONENT_NAME];
        return {id: record.id, name: record.name, enabled: record.enabled, components};
    });
    return {format: document.format, version: document.version, entities};
}

function requireSingleRoot(document: SceneDocument): void {
    const roots = documentTree(document).roots.length;
    if (roots !== 1) throw new Error(`A prefab document needs exactly one root entity; this one has ${roots}`);
}

function orderedLiveChildren(world: World, parent: Entity): Entity[] {
    return childrenComponent(world, parent).children.filter(child => world.entityManager.exists(child) && parentOf(world, child) === parent);
}

export class PrefabLibrary {
    private readonly documents = new Map<string, SceneDocument>();

    public constructor(private readonly world: World, private readonly registry: ComponentSchemaRegistry, private readonly assets: SceneAssetLoader) {
    }

    public documentOf(sourcePath: string): SceneDocument | undefined {
        return this.documents.get(sourcePath);
    }

    public remember(sourcePath: string, document: SceneDocument): SceneDocument {
        const normalized = this.normalize(document);
        this.documents.set(sourcePath, normalized);
        return normalized;
    }

    public instantiate(document: SceneDocument, sourcePath: string, parent: Entity | null, siblingIndex: number | undefined): InstantiatedDocument {
        requireSingleRoot(document);
        this.remember(sourcePath, document);
        const created = instantiateDocument(this.world, this.registry, document, {
            assets: this.assets,
            parent,
            siblingIndex,
            unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
            schemaChanges: REPORTED_SCHEMA_CHANGES,
        });
        const root = created.roots[0];
        const entityManager = this.world.entityManager;
        const existing = entityManager.getComponent<PrefabInstance>(root, PrefabInstance);
        if (existing !== undefined) {
            existing.sourcePath = sourcePath;
            existing.overrides = [];
        } else {
            entityManager.addComponent(root, new PrefabInstance(sourcePath, []));
        }
        this.refresh(root);
        return created;
    }

    public instanceRootsAround(entities: Iterable<Entity>): Set<Entity> {
        const roots = new Set<Entity>();
        const instanceType = ComponentType.of(PrefabInstance);
        for (const entity of entities) {
            const visited = new Set<Entity>();
            for (let current: Entity | undefined = entity; current !== undefined && !visited.has(current); current = parentOf(this.world, current)) {
                visited.add(current);
                if (!this.world.entityManager.exists(current)) break;
                if (untrackedComponentOf(this.world, current, instanceType) !== undefined) roots.add(current);
            }
        }
        return roots;
    }

    public refreshAround(entities: Iterable<Entity>): void {
        for (const root of this.instanceRootsAround(entities)) this.refresh(root);
    }

    public refresh(root: Entity): void {
        const instance = this.world.entityManager.getComponent<PrefabInstance>(root, PrefabInstance);
        if (instance === undefined) return;
        const prefab = this.documents.get(instance.sourcePath);
        if (prefab === undefined) return;
        const overrides = diffPrefabOverrides(prefab, serializeEntities(this.world, this.registry, [root]).document, this.registry);
        const unchanged = overrides.length === instance.overrides.length && overrides.every((path, index) => path === instance.overrides[index]);
        if (!unchanged) instance.overrides = overrides;
    }

    public overridesOf(entity: Entity): PrefabOverridesResult {
        const instance = this.requireInstance(entity);
        return {sourcePath: instance.sourcePath, overrides: [...instance.overrides]};
    }

    public revert(entity: Entity, paths: readonly string[] | undefined): PrefabOverridesResult {
        const instance = this.requireInstance(entity);
        const prefab = this.requireDocument(instance.sourcePath);
        this.refresh(entity);
        const reverted = new Set(paths ?? instance.overrides);
        this.sync(entity, prefab, new Set(instance.overrides.filter(path => !reverted.has(path))));
        this.refresh(entity);
        return this.overridesOf(entity);
    }

    public apply(entity: Entity): SceneDocument {
        const instance = this.requireInstance(entity);
        const document = withoutInstanceData(serializeEntities(this.world, this.registry, [entity]).document);
        const previous = this.documents.get(instance.sourcePath);
        if (previous === undefined) return document;
        const previousRoot = previous.entities[documentTree(previous).roots[0]];
        const rootIndex = documentTree(document).roots[0];
        const root = document.entities[rootIndex];
        const components: {[typeName: string]: SceneFieldValues} = {...root.components};
        for (const typeName of ROOT_DEFAULT_OVERRIDE_TYPES) {
            const kept = previousRoot.components[typeName];
            if (kept === undefined) delete components[typeName];
            else components[typeName] = kept;
        }
        const entities = [...document.entities];
        entities[rootIndex] = {id: root.id, name: previousRoot.name, enabled: root.enabled, components};
        return {format: document.format, version: document.version, entities};
    }

    public update(sourcePath: string, document: SceneDocument): Entity[] {
        requireSingleRoot(document);
        const hadPrevious = this.documents.has(sourcePath);
        const roots = this.instancesOf(sourcePath);
        if (hadPrevious) for (const root of roots) this.refresh(root);
        const normalized = this.remember(sourcePath, document);
        for (const root of roots) {
            const instance = this.requireInstance(root);
            this.sync(root, normalized, new Set(instance.overrides));
            this.refresh(root);
        }
        return roots;
    }

    public instancesOf(sourcePath: string): Entity[] {
        const instanceType = ComponentType.of(PrefabInstance);
        return sceneEntitiesInCreationOrder(this.world).filter(entity =>
            untrackedComponentOf<PrefabInstance>(this.world, entity, instanceType)?.sourcePath === sourcePath);
    }

    private requireInstance(entity: Entity): PrefabInstance {
        requireSceneEntity(this.world, entity);
        const instance = this.world.entityManager.getComponent<PrefabInstance>(entity, PrefabInstance);
        if (instance === undefined) throw new Error(`Entity ${entity} is not a prefab instance root (it has no PrefabInstance)`);
        return instance;
    }

    private requireDocument(sourcePath: string): SceneDocument {
        const document = this.documents.get(sourcePath);
        if (document === undefined) throw new Error(`The prefab "${sourcePath}" is not loaded; instantiate it or send updatePrefabInstances first`);
        return document;
    }

    private normalize(document: SceneDocument): SceneDocument {
        requireSingleRoot(document);
        const scratch = new World({platform: this.world.platform});
        try {
            const created = instantiateDocument(scratch, this.registry, document, {
                assets: this.assets,
                unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
                schemaChanges: REPORTED_SCHEMA_CHANGES,
            });
            return withoutInstanceData(serializeEntities(scratch, this.registry, created.roots).document);
        } finally {
            for (const entity of sceneEntitiesInCreationOrder(scratch)) scratch.entityManager.destroyEntity(entity);
        }
    }

    private sync(root: Entity, prefab: SceneDocument, kept: ReadonlySet<string>): void {
        const tree = documentTree(prefab);
        const state: PrefabSync = {prefab, tree, paths: entityPathsOf(prefab, tree), kept, matched: new Map(), created: new Set()};
        this.syncStructure(state, tree.roots[0], root, ROOT_ENTITY_PATH);
        for (const [prefabIndex, entity] of state.matched) {
            if (!state.created.has(entity)) this.syncEntity(state, prefabIndex, entity);
        }
    }

    private syncStructure(state: PrefabSync, prefabIndex: number, entity: Entity, path: string): void {
        state.matched.set(prefabIndex, entity);
        const prefabChildren = state.tree.childrenOf(prefabIndex);
        const liveChildren = orderedLiveChildren(this.world, entity);
        const doomed: Entity[] = [];
        const count = Math.max(prefabChildren.length, liveChildren.length);
        for (let index = 0; index < count; index++) {
            const childPath = childEntityPath(path, index);
            if (state.kept.has(childPath)) continue;
            const prefabChild = prefabChildren[index], liveChild = liveChildren[index];
            if (prefabChild !== undefined && liveChild !== undefined) this.syncStructure(state, prefabChild, liveChild, childPath);
            else if (prefabChild !== undefined) this.createChild(state, prefabChild, entity, index);
            else doomed.push(liveChild);
        }
        for (const child of doomed) destroyWithDescendants(this.world, child);
    }

    private createChild(state: PrefabSync, prefabIndex: number, parent: Entity, siblingIndex: number): void {
        const created = instantiateDocument(this.world, this.registry, subtreeDocument(state.prefab, prefabIndex), {
            assets: this.assets,
            parent,
            siblingIndex,
            unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
        });
        subtreeRecordIndices(state.prefab, prefabIndex).forEach((sourceIndex, index) => {
            state.matched.set(sourceIndex, created.entities[index]);
            state.created.add(created.entities[index]);
        });
    }

    private decodeContext(state: PrefabSync): FieldDecodeContext {
        return {
            entityOf: sceneId => {
                const index = state.tree.indexById.get(sceneId);
                return index === undefined ? undefined : state.matched.get(index);
            },
            reportDanglingEntity: ignore,
            assets: this.assets,
        };
    }

    private encodeContext(state: PrefabSync): FieldEncodeContext {
        const idByEntity = new Map<Entity, number>();
        for (const [index, entity] of state.matched) idByEntity.set(entity, state.prefab.entities[index].id);
        return {sceneIdOf: entity => idByEntity.get(entity), reportDanglingEntity: ignore, reportUnsavedAsset: ignore};
    }

    private syncEntity(state: PrefabSync, prefabIndex: number, entity: Entity): void {
        const path = state.paths.get(prefabIndex) ?? ROOT_ENTITY_PATH;
        const isRoot = path === ROOT_ENTITY_PATH;
        const record = state.prefab.entities[prefabIndex];
        const entityManager = this.world.entityManager;
        if (!isRoot && !state.kept.has(entityPropertyPath(path, ENTITY_NAME_PROPERTY)) && (entityManager.nameOf(entity) ?? null) !== record.name) {
            renameEntity(this.world, entity, record.name);
        }
        if (!state.kept.has(entityPropertyPath(path, ENTITY_ENABLED_PROPERTY)) && entityManager.isEnabled(entity) !== record.enabled) {
            setEntityEnabled(this.world, entity, record.enabled);
        }
        const decode = this.decodeContext(state);
        const encode = this.encodeContext(state);
        for (const typeName of Object.keys(record.components)) {
            if (!isComparedComponent(typeName, isRoot) || state.kept.has(componentOverridePath(path, typeName))) continue;
            const schema = this.registry.byName(typeName);
            if (schema === undefined || schema.persistence === "implied") continue;
            this.syncComponent(entity, schema, record.components[typeName], path, state.kept, decode, encode);
        }
        for (const type of getOwner(this.world, entity)!.componentTypes) {
            const schema = this.registry.byType(type);
            if (schema === undefined || schema.persistence === "implied" || record.components[schema.name] !== undefined) continue;
            if (!isComparedComponent(schema.name, isRoot) || state.kept.has(componentOverridePath(path, schema.name))) continue;
            entityManager.removeComponent(entity, type);
        }
    }

    private syncComponent(
        entity: Entity,
        schema: ComponentSchema,
        values: SceneFieldValues,
        path: string,
        kept: ReadonlySet<string>,
        decode: FieldDecodeContext,
        encode: FieldEncodeContext,
    ): void {
        const entityManager = this.world.entityManager;
        const type = ComponentType.of(schema.ctor);
        const existing = entityManager.getComponent<Component>(entity, type);
        if (existing === undefined) {
            const component = schema.create();
            for (const field of schema.fields) {
                const json = values[field.key];
                if (json !== undefined) fieldsOf(component)[field.key] = decodeFieldValue(field, json, decode, `${path}/${schema.name}.${field.key}`);
            }
            const missesEntity = schema.fields.some(field => isEntityField(field) && !field.nullable && fieldsOf(component)[field.key] === NULL_ENTITY);
            if (!missesEntity && !(component instanceof Parent)) entityManager.addComponent(entity, component);
            return;
        }
        for (const field of schema.fields) {
            const json = values[field.key];
            if (json === undefined || kept.has(fieldOverridePath(path, schema.name, field.key))) continue;
            const fieldPath = `${path}/${schema.name}.${field.key}`;
            const current = fieldsOf(existing)[field.key];
            let equal: boolean;
            try {
                equal = sceneJsonEquals(encodeFieldValue(field, current, encode, fieldPath), json);
            } catch {
                equal = false;
            }
            if (!equal) fieldsOf(existing)[field.key] = decodeFieldValue(field, json, decode, fieldPath);
        }
    }
}
