import type {Entity, World} from "../../engine/core";
import {ComponentType} from "../../engine/core/componentType";
import {
    ActiveScene,
    encodeFieldValue,
    FIRST_SCENE_ENTITY_ID,
    NO_SCENE_ID,
    SCENE_DOCUMENT_FORMAT,
    SCENE_DOCUMENT_VERSION,
    SceneInstance,
    serializeEntities,
    untrackedComponentOf,
} from "../../engine/scene";
import type {
    ComponentSchemaRegistry,
    FieldEncodeContext,
    SceneDocument,
    SceneFieldValues,
    SceneHandle,
    SceneManager,
    SerializedScene,
} from "../../engine/scene";
import type {EditorSceneRef} from "../editorProtocol";
import {parentOf, sceneRoots} from "./entityInspection";

type EncodedResources = {[resourceName: string]: SceneFieldValues};

const ADDITIVE = "additive";

export function emptySceneDocument(): SceneDocument {
    return {format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []};
}

function fieldsOf(value: object): Record<string, unknown> {
    return value as unknown as Record<string, unknown>;
}

function encodedResources(world: World, registry: ComponentSchemaRegistry, context: FieldEncodeContext): EncodedResources | undefined {
    let resources: EncodedResources | undefined;
    for (const schema of registry.resourceSchemas) {
        const resource = world.resources.tryGet(schema.ctor);
        if (resource === undefined) continue;
        const values: SceneFieldValues = {};
        const current = fieldsOf(resource);
        for (const field of schema.fields) values[field.key] = encodeFieldValue(field, current[field.key], context, `resources.${schema.name}.${field.key}`);
        (resources ??= {})[schema.name] = values;
    }
    return resources;
}

export function serializeSceneRoots(world: World, registry: ComponentSchemaRegistry, roots: readonly Entity[], withResources: boolean): SerializedScene {
    const saved = serializeEntities(world, registry, roots);
    if (!withResources) return saved;
    const recordIds = new Map<Entity, number>();
    saved.entities.forEach((entity, index) => recordIds.set(entity, index + FIRST_SCENE_ENTITY_ID));
    const danglingEntityRefs = [...saved.report.danglingEntityRefs];
    const unsavedAssets = [...saved.report.unsavedAssets];
    const resources = encodedResources(world, registry, {
        sceneIdOf: entity => recordIds.get(entity),
        reportDanglingEntity: path => danglingEntityRefs.push(path),
        reportUnsavedAsset: path => unsavedAssets.push(path),
        inlineSpriteImageEncodings: new Map(),
        fieldTypes: registry,
    });
    return {
        document: resources === undefined ? saved.document : {...saved.document, resources},
        entities: saved.entities,
        report: {skippedComponentTypes: saved.report.skippedComponentTypes, danglingEntityRefs, unsavedAssets},
    };
}

export class SceneMembership {
    public constructor(private readonly world: World, private readonly scenes: SceneManager) {
    }

    public activeSceneId(): number {
        return this.scenes.active()?.id ?? NO_SCENE_ID;
    }

    public loadedScenes(): EditorSceneRef[] {
        return this.scenes.loaded().map(handle => ({id: handle.id, path: handle.path ?? null}));
    }

    public loadedScene(sceneId: number): SceneHandle | undefined {
        if (sceneId === NO_SCENE_ID) return undefined;
        return this.scenes.loaded().find(handle => handle.id === sceneId);
    }

    public sceneIdOf(entity: Entity): number {
        return this.rootTag(this.rootOf(entity))?.sceneId ?? this.activeSceneId();
    }

    public sceneLookup(): (entity: Entity) => number {
        const active = this.activeSceneId();
        const byRoot = new Map<Entity, number>();
        return entity => {
            const root = this.rootOf(entity);
            let sceneId = byRoot.get(root);
            if (sceneId === undefined) byRoot.set(root, sceneId = this.rootTag(root)?.sceneId ?? active);
            return sceneId;
        };
    }

    public rootSceneOf(entity: Entity): EditorSceneRef | undefined {
        const tag = this.rootTag(this.rootOf(entity));
        return tag === undefined ? undefined : {id: tag.sceneId, path: tag.path ?? null};
    }

    public memberRoots(sceneId: number): Entity[] {
        const active = this.activeSceneId();
        return sceneRoots(this.world).filter(root => (this.rootTag(root)?.sceneId ?? active) === sceneId);
    }

    public untaggedRoots(): Entity[] {
        return sceneRoots(this.world).filter(root => this.rootTag(root) === undefined);
    }

    public adoptUntaggedRoots(): void {
        const active = this.scenes.active();
        if (active === undefined) return;
        for (const root of this.untaggedRoots()) this.scenes.moveToScene(root, active);
    }

    public placeRoot(root: Entity, scene: EditorSceneRef | undefined): void {
        if (scene === undefined || scene.id === NO_SCENE_ID) {
            if (this.world.entityManager.getComponent(root, SceneInstance) !== undefined) this.world.entityManager.removeComponent(root, SceneInstance);
            return;
        }
        const path = scene.path ?? undefined;
        const existing = this.world.entityManager.getComponent<SceneInstance>(root, SceneInstance);
        if (existing === undefined) {
            this.world.entityManager.addComponent(root, new SceneInstance(scene.id, path));
            return;
        }
        if (existing.sceneId !== scene.id) existing.sceneId = scene.id;
        if (existing.path !== path) existing.path = path;
    }

    public renameScene(sceneId: number, path: string | undefined): void {
        const renamed: SceneHandle = {id: sceneId, path};
        for (const root of sceneRoots(this.world)) if (this.rootTag(root)?.sceneId === sceneId) this.scenes.moveToScene(root, renamed);
        if (this.activeSceneId() === sceneId) this.scenes.setActive(renamed);
    }

    public clearActiveScene(): void {
        const active = this.world.resources.getOrCreate(ActiveScene);
        active.sceneId = NO_SCENE_ID;
        active.path = undefined;
    }

    public createActiveScene(path: string | undefined): SceneHandle {
        this.clearActiveScene();
        return this.scenes.loadDocument(emptySceneDocument(), {mode: ADDITIVE, path}).handle;
    }

    private rootOf(entity: Entity): Entity {
        const visited = new Set<Entity>([entity]);
        let root = entity;
        for (let parent = parentOf(this.world, root); parent !== undefined && !visited.has(parent); parent = parentOf(this.world, root)) {
            visited.add(parent);
            root = parent;
        }
        return root;
    }

    private rootTag(root: Entity): SceneInstance | undefined {
        const tag = untrackedComponentOf<SceneInstance>(this.world, root, ComponentType.of(SceneInstance));
        return tag === undefined || tag.sceneId === NO_SCENE_ID ? undefined : tag;
    }
}
