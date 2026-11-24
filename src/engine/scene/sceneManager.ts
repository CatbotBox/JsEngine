import {EntityCommandBufferSystem} from "../core";
import type {Entity, World} from "../core";
import {ComponentType} from "../core/componentType";
import type {EntityArchetype} from "../core/entityArchetype";
import type {FileSource} from "../platform/platform";
import type {AnyCT} from "../util/tokenUtils";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {EditorOnly} from "./editorOnly";
import {parseSceneDocument} from "./sceneDocument";
import type {SceneDocument} from "./sceneDocument";
import {dataAssetsOf} from "./dataAssets";
import {prefabSpawnerOf} from "./prefabSpawner";
import {SceneLoader} from "./sceneLoader";
import {preloadAssetReferences, sceneAssetPaths} from "./sceneAssets";
import type {AssetPreload, SceneAssetLoader, SceneAssetReference} from "./sceneAssets";
import {parentEntityOf, SceneRootOrder, untrackedComponentOf} from "./sceneHierarchy";
import {deserializeInto, isSceneEntity, sceneEntitiesInCreationOrder} from "./sceneSerialization";
import type {SceneLoadResult, SchemaChangePolicy, UnknownComponentTypePolicy} from "./sceneSerialization";
import {ActiveScene, NO_SCENE_ID, SceneInstance, withoutSceneMembership} from "./sceneInstance";

export type SceneLoadMode = "single" | "additive";

export type PersistentEntityPolicy = "keep" | "destroy";

export type SceneActivation = "immediate" | "onCommandBufferPlayback";

export type ScenePreload = AssetPreload;

export type SceneLoadedListener = (scene: LoadedScene) => void;

export interface SceneHandle {
    readonly id: number;
    readonly path: string | undefined;
}

export interface SceneManagerOptions {
    readonly files?: FileSource;
    readonly assets?: SceneAssetLoader;
    readonly preload?: ScenePreload;
    readonly unknownComponentTypes?: UnknownComponentTypePolicy;
    readonly schemaChanges?: SchemaChangePolicy;
}

export interface SceneLoadRequest {
    readonly mode?: SceneLoadMode;
    readonly persistentEntities?: PersistentEntityPolicy;
    readonly activation?: SceneActivation;
}

export interface SceneDocumentLoadRequest extends SceneLoadRequest {
    readonly path?: string;
}

export interface LoadedScene extends SceneLoadResult {
    readonly handle: SceneHandle;
    readonly mode: SceneLoadMode;
    readonly roots: readonly Entity[];
}

const DEFAULT_LOAD_MODE: SceneLoadMode = "single";
const DEFAULT_PERSISTENT_ENTITY_POLICY: PersistentEntityPolicy = "keep";
const DEFAULT_ACTIVATION: SceneActivation = "immediate";
const ENABLED = true;
const DISABLED = false;
const NO_ENTITIES: readonly Entity[] = [];
const FIRST_LOAD_GENERATION = 0;

export class SceneLoadCancelledError extends Error {
    public override readonly name = "SceneLoadCancelledError";

    public constructor(public readonly path: string) {
        super(`Loading the scene ${path} was cancelled: cancelPendingLoads ran before it finished`);
    }
}

function noPreload(): Promise<void> {
    return Promise.resolve();
}

function sceneLabel(handle: SceneHandle): string {
    return handle.path === undefined ? `scene ${handle.id}` : `scene ${handle.id} (${handle.path})`;
}

function isEditorOnlyArchetype(archetype: EntityArchetype<AnyCT>): boolean {
    return archetype.getColumn(ComponentType.of(EditorOnly)) !== undefined;
}

function requireMembershipSchemas(registry: ComponentSchemaRegistry): void {
    if (registry.byType(ComponentType.of(SceneInstance)) !== undefined && registry.resourceByCtor(ActiveScene) !== undefined) return;
    throw new Error("SceneManager: the registry has no SceneInstance or ActiveScene schema; call registerEngineComponentSchemas before creating the manager");
}

export class SceneManager {
    public readonly assets: SceneAssetLoader;
    private readonly files: FileSource;
    private readonly preload: ScenePreload;
    private readonly listeners = new Set<SceneLoadedListener>();
    private readonly handles = new Map<number, SceneHandle>();
    private lastSceneId = NO_SCENE_ID;
    private loadGeneration = FIRST_LOAD_GENERATION;

    public constructor(private readonly world: World, private readonly registry: ComponentSchemaRegistry, private readonly options: SceneManagerOptions = {}) {
        requireMembershipSchemas(registry);
        this.files = options.files ?? world.platform.files;
        this.assets = options.assets ?? dataAssetsOf(world, registry, {files: this.files, inflate: world.platform.inflate}, {schemaChanges: options.schemaChanges}).assets;
        this.preload = options.preload ?? noPreload;
        prefabSpawnerOf(world, registry, this.assets, {unknownComponentTypes: options.unknownComponentTypes, schemaChanges: options.schemaChanges});
        world.resources.getOrCreate(ActiveScene);
        world.resources.insert(new SceneLoader(this));
    }

    public async load(path: string, request: SceneLoadRequest = {}): Promise<SceneHandle> {
        const generation = this.loadGeneration;
        await this.preload([path]);
        this.requireLoadNotCancelled(generation, path);
        const document = parseSceneDocument(this.files.readText(path), path);
        await this.preloadAssets(sceneAssetPaths(document, this.registry));
        this.requireLoadNotCancelled(generation, path);
        return this.loadDocument(document, {...request, path}).handle;
    }

    public cancelPendingLoads(): void {
        this.loadGeneration++;
    }

    public preloadAssets(references: readonly SceneAssetReference[]): Promise<void> {
        return preloadAssetReferences(references, this.registry, this.files, this.preload);
    }

    public loadDocument(document: SceneDocument, request: SceneDocumentLoadRequest = {}): LoadedScene {
        const mode = request.mode ?? DEFAULT_LOAD_MODE;
        const persistentEntities = request.persistentEntities ?? DEFAULT_PERSISTENT_ENTITY_POLICY;
        if (mode === "additive" && persistentEntities === "destroy") {
            throw new Error("SceneManager.loadDocument: only a single load can destroy persistent entities");
        }
        const replacedScenes = mode === "single" ? this.loadedSceneIds() : new Set<number>();
        const replaced = mode === "additive" ? NO_ENTITIES
            : persistentEntities === "destroy" ? sceneEntitiesInCreationOrder(this.world)
            : this.membersOf(replacedScenes);
        const archetypesBeforeLoad = new Set(this.world.archetypes.values());
        const loaded = deserializeInto(this.world, this.registry, withoutSceneMembership(document), {
            assets: this.assets,
            unknownComponentTypes: this.options.unknownComponentTypes,
            schemaChanges: this.options.schemaChanges,
        });
        const handle = this.handleOf(this.nextSceneId(), request.path);
        const roots = loaded.entities.filter(entity => parentEntityOf(this.world, entity) === undefined);
        for (const root of roots) this.world.entityManager.addComponent(root, new SceneInstance(handle.id, handle.path));
        this.world.archetypes.prune(archetype => !archetypesBeforeLoad.has(archetype));
        if ((request.activation ?? DEFAULT_ACTIVATION) === "onCommandBufferPlayback") this.activateOnCommandBufferPlayback(loaded.entities);
        this.destroy(replaced);
        this.forgetScenes(replacedScenes);
        if (mode === "single" || this.activeScene().sceneId === NO_SCENE_ID) this.writeActive(handle);
        const scene: LoadedScene = {handle, mode, roots, entities: loaded.entities, report: loaded.report};
        this.announce(scene);
        return scene;
    }

    public unload(handle: SceneHandle): void {
        this.requireLoaded(handle, "unload");
        const unloaded = new Set([handle.id]);
        this.destroy(this.membersOf(unloaded));
        this.forgetScenes(unloaded);
        if (this.activeScene().sceneId === handle.id) this.writeActive(this.loaded().find(scene => scene.id !== handle.id));
    }

    public setActive(handle: SceneHandle): void {
        this.requireLoaded(handle, "setActive");
        this.writeActive(handle);
    }

    public active(): SceneHandle | undefined {
        const active = this.activeScene();
        return active.sceneId === NO_SCENE_ID ? undefined : this.handleOf(active.sceneId, active.path);
    }

    public loaded(): SceneHandle[] {
        return [...this.loadedScenes()].sort(([a], [b]) => a - b).map(([id, path]) => this.handleOf(id, path));
    }

    public isLoaded(handle: SceneHandle): boolean {
        return this.loadedScenes().has(handle.id);
    }

    public sceneOf(entity: Entity): SceneHandle | undefined {
        if (!isSceneEntity(this.world, entity)) return undefined;
        const tag = this.rootTagOf(entity);
        return tag === undefined ? undefined : this.handleOf(tag.sceneId, tag.path);
    }

    public moveToScene(entity: Entity, handle: SceneHandle | undefined = this.active()): void {
        if (handle === undefined) throw new Error("SceneManager.moveToScene: no scene is active; load one or name the target scene");
        this.requireLoaded(handle, "moveToScene");
        if (!isSceneEntity(this.world, entity)) throw new Error(`SceneManager.moveToScene: entity ${entity} is not a scene entity of this world`);
        if (parentEntityOf(this.world, entity) !== undefined) {
            throw new Error(`SceneManager.moveToScene: entity ${entity} has a parent; only root entities move between scenes`);
        }
        const entityManager = this.world.entityManager;
        const existing = entityManager.getComponent<SceneInstance>(entity, SceneInstance);
        if (existing === undefined) {
            entityManager.addComponent(entity, new SceneInstance(handle.id, handle.path));
            return;
        }
        if (existing.sceneId !== handle.id) existing.sceneId = handle.id;
        if (existing.path !== handle.path) existing.path = handle.path;
    }

    public onLoaded(listener: SceneLoadedListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private requireLoadNotCancelled(generation: number, path: string): void {
        if (generation !== this.loadGeneration) throw new SceneLoadCancelledError(path);
    }

    private activateOnCommandBufferPlayback(entities: readonly Entity[]): void {
        const entityManager = this.world.entityManager;
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        for (const entity of entities) {
            if (!entityManager.isEnabled(entity)) continue;
            entityManager.setEnabledState(entity, DISABLED);
            buffer.setEnabledState(entity, ENABLED);
        }
    }

    private activeScene(): ActiveScene {
        return this.world.resources.getOrCreate(ActiveScene);
    }

    private writeActive(handle: SceneHandle | undefined): void {
        const active = this.activeScene();
        active.sceneId = handle?.id ?? NO_SCENE_ID;
        active.path = handle?.path;
    }

    private handleOf(id: number, path: string | undefined): SceneHandle {
        const cached = this.handles.get(id);
        if (cached !== undefined && cached.path === path) return cached;
        const handle: SceneHandle = Object.freeze({id, path});
        this.handles.set(id, handle);
        return handle;
    }

    private nextSceneId(): number {
        this.lastSceneId = Math.max(this.lastSceneId, this.highestSceneIdInWorld()) + 1;
        return this.lastSceneId;
    }

    private requireLoaded(handle: SceneHandle, action: string): void {
        if (!this.isLoaded(handle)) throw new Error(`SceneManager.${action}: ${sceneLabel(handle)} is not loaded`);
    }

    private forEachSceneTag(visit: (entity: Entity, tag: SceneInstance) => void): void {
        const type = ComponentType.of(SceneInstance);
        for (const archetype of this.world.archetypes.values()) {
            const column = archetype.getColumn(type);
            if (column === undefined || isEditorOnlyArchetype(archetype)) continue;
            const count = archetype.entityCountIncludingDisabled;
            for (let row = 0; row < count; row++) visit(archetype.getEntityAtIndex(row), column.get(row) as SceneInstance);
        }
    }

    private highestSceneIdInWorld(): number {
        let highest = this.activeScene().sceneId;
        this.forEachSceneTag((_, tag) => {
            highest = Math.max(highest, tag.sceneId);
        });
        return highest;
    }

    private loadedScenes(): Map<number, string | undefined> {
        const scenes = new Map<number, string | undefined>();
        this.forEachSceneTag((entity, tag) => {
            if (tag.sceneId === NO_SCENE_ID || scenes.has(tag.sceneId) || parentEntityOf(this.world, entity) !== undefined) return;
            scenes.set(tag.sceneId, tag.path);
        });
        const active = this.activeScene();
        if (active.sceneId !== NO_SCENE_ID && !scenes.has(active.sceneId)) scenes.set(active.sceneId, active.path);
        return scenes;
    }

    private loadedSceneIds(): Set<number> {
        return new Set(this.loadedScenes().keys());
    }

    private rootOf(entity: Entity): Entity {
        const visited = new Set<Entity>([entity]);
        let root = entity;
        for (let parent = parentEntityOf(this.world, root); parent !== undefined && !visited.has(parent); parent = parentEntityOf(this.world, root)) {
            visited.add(parent);
            root = parent;
        }
        return root;
    }

    private rootTagOf(entity: Entity): SceneInstance | undefined {
        const root = this.rootOf(entity);
        if (!isSceneEntity(this.world, root)) return undefined;
        const tag = untrackedComponentOf<SceneInstance>(this.world, root, ComponentType.of(SceneInstance));
        return tag === undefined || tag.sceneId === NO_SCENE_ID ? undefined : tag;
    }

    private membersOf(sceneIds: ReadonlySet<number>): Entity[] {
        if (sceneIds.size === 0) return [];
        return sceneEntitiesInCreationOrder(this.world).filter(entity => {
            const tag = this.rootTagOf(entity);
            return tag !== undefined && sceneIds.has(tag.sceneId);
        });
    }

    private destroy(entities: readonly Entity[]): void {
        if (entities.length === 0) return;
        const entityManager = this.world.entityManager;
        for (const entity of entities) if (entityManager.exists(entity)) entityManager.destroyEntity(entity);
        const order = this.world.resources.tryGet(SceneRootOrder);
        if (order === undefined) return;
        const destroyed = new Set(entities);
        order.roots = order.roots.filter(root => !destroyed.has(root));
    }

    private forgetScenes(sceneIds: ReadonlySet<number>): void {
        if (sceneIds.size === 0) return;
        const stale: Entity[] = [];
        this.forEachSceneTag((entity, tag) => {
            if (sceneIds.has(tag.sceneId)) stale.push(entity);
        });
        for (const entity of stale) this.world.entityManager.removeComponent(entity, SceneInstance);
    }

    private announce(scene: LoadedScene): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(scene);
            } catch (error) {
                console.error(`SceneManager: an onLoaded listener failed after loading ${sceneLabel(scene.handle)}`, error);
            }
        }
    }
}
