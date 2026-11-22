import {EntityCommandBufferSystem} from "../../engine/core";
import type {ResourceCtor} from "../../engine/core/resource";
import type {Entity, Resource, System, SystemCtor, World, WorldStoppedEvent} from "../../engine/core";
import {
    applySceneInPlace,
    DataAssets,
    describeSchemaChange,
    deserializeInto,
    encodeDataAssetFields,
    NO_SCENE_ID,
    parseSceneDocument,
    sceneAssetPaths,
    SceneManager,
    serializeEntities,
    serializeWorld,
    instantiateDocument,
    withoutSceneMembership,
} from "../../engine/scene";
import type {
    ComponentSchemaRegistry,
    DataAssetSchemaChanges,
    SceneAssetLoader,
    SceneAssetReference,
    SceneDocument,
    SceneJsonObject,
    SceneLoadResult,
    ScenePreload,
    SceneSnapshot,
} from "../../engine/scene";
import {EDITOR_MESSAGE_TYPE, isEditorRequestMessage, requestIdOfMalformedEditorRequest} from "../editorProtocol";
import type {
    EditorEvent,
    EditorMode,
    EditorRequest,
    EditorRequestMessage,
    EditorResponseMessage,
    EditorResult,
    EditorSceneRef,
    EditorServiceState,
    EditorView,
    EditorWorldMessage,
    ExportSnapshotResult,
    ImportSnapshotRequest,
    ImportSnapshotResult,
    InstantiateEntitiesRequest,
    InstantiateEntitiesResult,
    ListEntitiesResult,
    LoadSceneRequest,
    LoadSceneResult,
    ReloadDataAssetResult,
    SaveSceneResult,
    SetActiveSceneResult,
    SetFieldResult,
    SetResourceFieldRequest,
    UnloadSceneResult,
} from "../editorProtocol";
import {GameplaySystemGate, GameplayTickCounterSystem} from "./gameplaySystemGate";
import {describeSchemas, entitiesInCreationOrder, entityDetails, entitySummaries, parentOf, requireSceneEntity, sceneRoots} from "./entityInspection";
import {SceneMembership, serializeSceneRoots} from "./sceneMembership";
import {
    addComponentTo,
    assetReferencesOf,
    assetReferencesOfEdits,
    assignField,
    assignFields,
    createEditorEntity,
    destroyAllEntities,
    destroyWithDescendants,
    removeComponentFrom,
    renameEntity,
    setEntityEnabled,
} from "./entityEditing";
import {duplicateEntities, setParent} from "./hierarchyEditing";
import {EditorViews} from "./editorViews";
import {PrefabLibrary} from "./prefabEditing";
import {ConsoleForwarder} from "./consoleForwarding";
import {exportWorldSnapshot, importedEditSnapshot} from "./editorSnapshots";
import {
    assignResourceField,
    defaultResourceFields,
    describeAssetTypes,
    listSettings,
    resourceDetails,
    resourceFieldAssetReferences,
    withoutDataAssetResources,
} from "./settingsInspection";

export interface EditorServiceScope {
    postMessage(message: EditorWorldMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface EditorWorldServiceOptions {
    readonly preloadAssets?: ScenePreload;
    readonly gameplaySystems?: readonly SystemCtor<System>[];
    readonly tickIntervalMs?: number;
    readonly scenes?: SceneManager;
    readonly refetchFiles?: (paths: readonly string[]) => Promise<void>;
}

const SCENE_TEXT_INDENT_SPACES = 2;
const NO_VALUES: SceneJsonObject = {};
const NO_ENTITIES: readonly Entity[] = [];
const PLAIN_STOP_TEXT = "The world was stopped";
const SKIPPED_UNKNOWN_TYPES = "skip";
const REPORTED_SCHEMA_CHANGES = "report";
const OPENED_SCENE_MODE = "single";
const ADDED_SCENE_MODE = "additive";
const OPENED_SCENE_PERSISTENT_ENTITIES = "destroy";
const NO_GAMEPLAY_SYSTEMS: readonly SystemCtor<System>[] = [];

export function editorSceneManager(world: World, registry: ComponentSchemaRegistry, preload?: ScenePreload): SceneManager {
    return new SceneManager(world, registry, {preload, unknownComponentTypes: SKIPPED_UNKNOWN_TYPES, schemaChanges: REPORTED_SCHEMA_CHANGES});
}

function warnDataAssetSchemaChanges(report: DataAssetSchemaChanges): void {
    for (const change of report.changes) console.warn(`Data asset ${report.path}: ${describeSchemaChange(change)}`);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function documentText(document: SceneDocument): string {
    return JSON.stringify(document, null, SCENE_TEXT_INDENT_SPACES);
}

function liveOnly(world: World, entities: readonly (Entity | undefined)[]): Entity[] {
    return entities.filter((entity): entity is Entity => entity !== undefined && world.entityManager.exists(entity));
}

export class EditorWorldService {
    private _mode: EditorMode = "edit";
    private snapshot: SceneSnapshot | undefined;
    private viewBeforePlay: EditorView | undefined;
    private ticker: ReturnType<typeof setInterval> | undefined;
    private lastPlayTickMs = 0;
    private tickCount = 0;
    private tickMsTotal = 0;
    private pendingRequests: Promise<void> = Promise.resolve();
    private attached = true;
    private stoppedError: string | undefined;
    private readonly gate: GameplaySystemGate;
    private readonly tickCounter: GameplayTickCounterSystem;
    private readonly scenes: SceneManager;
    private readonly membership: SceneMembership;
    private readonly editedScenes = new Set<number>();
    private readonly assets: SceneAssetLoader;
    private readonly views: EditorViews;
    private readonly prefabs: PrefabLibrary;
    private readonly consoleForwarder: ConsoleForwarder;
    private readonly onWorldStopped = (event: WorldStoppedEvent) => this.worldStopped(event.error);
    private readonly onDataAssetSchemaChanged = (report: DataAssetSchemaChanges) => warnDataAssetSchemaChanges(report);

    public constructor(
        private readonly scope: EditorServiceScope,
        private readonly world: World,
        private readonly registry: ComponentSchemaRegistry,
        private readonly options: EditorWorldServiceOptions,
    ) {
        this.gate = new GameplaySystemGate(world, options.gameplaySystems ?? NO_GAMEPLAY_SYSTEMS);
        this.tickCounter = world.getOrCreateSystem(GameplayTickCounterSystem);
        this.scenes = options.scenes ?? editorSceneManager(world, registry, options.preloadAssets);
        this.membership = new SceneMembership(world, this.scenes);
        this.assets = this.scenes.assets;
        this.views = new EditorViews(world);
        this.prefabs = new PrefabLibrary(world, registry, this.assets);
        this.consoleForwarder = new ConsoleForwarder(event => this.postEvent(event));
    }

    public get mode(): EditorMode {
        return this._mode;
    }

    public get gameplayTicks(): number {
        return this.tickCounter.ticks;
    }

    public get view(): EditorView {
        return this.views.view;
    }

    public get worldStoppedError(): string | undefined {
        return this.stoppedError;
    }

    public attach(): void {
        this.world.pause();
        this.gate.suspend();
        this.world.onStopped.add(this.onWorldStopped);
        this.consoleForwarder.attach();
        this.reportDataAssetSchemaChanges();
        this.views.apply();
        this.startTicking();
        this.scope.addEventListener("message", event => this.receive(event.data));
    }

    public detach(): void {
        this.attached = false;
        this.stopTicking();
        this.world.onStopped.remove(this.onWorldStopped);
        this.world.resources.tryGet(DataAssets)?.onSchemaChanged.remove(this.onDataAssetSchemaChanged);
        this.consoleForwarder.detach();
        this.views.dispose();
        this.world.pause();
        this.gate.resume();
    }

    private receive(data: unknown): void {
        if (!this.attached) return;
        if (isEditorRequestMessage(data)) {
            this.pendingRequests = this.pendingRequests.then(() => this.answer(data)).catch(error => {
                console.error(`Editor: could not answer request ${data.requestId}: ${errorText(error)}`);
            });
            return;
        }
        const requestId = requestIdOfMalformedEditorRequest(data);
        if (requestId !== undefined) this.post({type: EDITOR_MESSAGE_TYPE, requestId, ok: false, error: "Malformed editor request"});
    }

    private async answer(message: EditorRequestMessage): Promise<void> {
        const requestId = message.requestId;
        let response: EditorResponseMessage;
        try {
            response = {type: EDITOR_MESSAGE_TYPE, requestId, ok: true, result: await this.perform(message.request)};
        } catch (error) {
            response = {type: EDITOR_MESSAGE_TYPE, requestId, ok: false, error: errorText(error)};
        }
        try {
            this.post(response);
        } catch (error) {
            this.post({type: EDITOR_MESSAGE_TYPE, requestId, ok: false, error: `The result could not be sent: ${errorText(error)}`});
        }
    }

    private post(message: EditorWorldMessage): void {
        if (this.attached) this.scope.postMessage(message);
    }

    private postEvent(event: EditorEvent): void {
        this.post({type: EDITOR_MESSAGE_TYPE, event});
    }

    private inGameView<T>(action: () => T): T {
        return this.views.withGameView(action);
    }

    private edit<T>(touched: readonly (Entity | undefined)[], action: () => T, touchedAfter: (result: T) => readonly (Entity | undefined)[] = () => NO_ENTITIES): T {
        return this.inGameView(() => {
            const scenesBefore = this.scenesOf(touched);
            const result = action();
            const after = liveOnly(this.world, [...touched, ...touchedAfter(result)]);
            this.prefabs.refreshAround(after);
            this.markScenesEdited([...scenesBefore, ...this.scenesOf(after)]);
            return result;
        });
    }

    private recordsSceneEdits(): boolean {
        return this._mode === "edit";
    }

    private scenesOf(entities: readonly (Entity | undefined)[]): number[] {
        if (!this.recordsSceneEdits()) return [];
        return liveOnly(this.world, entities).map(entity => this.membership.sceneIdOf(entity));
    }

    private markScenesEdited(sceneIds: readonly number[]): void {
        if (!this.recordsSceneEdits()) return;
        for (const sceneId of sceneIds) this.editedScenes.add(sceneId);
    }

    private requireEditing(action: string): void {
        if (this._mode !== "edit") throw new Error(`Cannot ${action} while the game runs; stop it first`);
    }

    private async preload(references: readonly SceneAssetReference[]): Promise<void> {
        if (references.length > 0) await this.scenes.preloadAssets(references);
    }

    private async preloadDocument(document: SceneDocument): Promise<void> {
        await this.preload(sceneAssetPaths(document, this.registry));
    }

    private async perform(request: EditorRequest): Promise<EditorResult> {
        const {world, registry} = this;
        switch (request.op) {
            case "describeSchemas":
                return this.inGameView(() => describeSchemas(world, registry));
            case "listEntities":
                return this.inGameView(() => this.listEntities());
            case "getEntity":
                return this.inGameView(() => entityDetails(world, registry, request.entity));
            case "setField":
                await this.preload(assetReferencesOf(registry, request.typeName, {[request.key]: request.value}));
                return this.edit([request.entity], () => ({value: assignField(world, registry, this.assets, request)}));
            case "setFields":
                await this.preload(assetReferencesOfEdits(registry, request.edits));
                return this.edit(request.edits.map(edit => edit.entity), () => ({values: assignFields(world, registry, this.assets, request.edits)}));
            case "addComponent": {
                const values = request.values ?? NO_VALUES;
                await this.preload(assetReferencesOf(registry, request.typeName, values));
                return this.edit([request.entity], () => {
                    addComponentTo(world, registry, this.assets, request.entity, request.typeName, values);
                    return entityDetails(world, registry, request.entity);
                });
            }
            case "removeComponent":
                return this.edit([request.entity], () => {
                    removeComponentFrom(world, registry, request.entity, request.typeName);
                    return entityDetails(world, registry, request.entity);
                });
            case "createEntity":
                return this.edit([request.parent], () => entityDetails(world, registry, createEditorEntity(world, request.name, request.parent)), created => [created.entity]);
            case "destroyEntity":
                return this.inGameView(() => {
                    const parent = parentOf(world, requireSceneEntity(world, request.entity));
                    const scenes = this.scenesOf([request.entity]);
                    const destroyed = this.edit([parent], () => ({destroyed: destroyWithDescendants(world, request.entity)}));
                    this.markScenesEdited(scenes);
                    return destroyed;
                });
            case "setEnabled":
                return this.edit([request.entity], () => {
                    setEntityEnabled(world, request.entity, request.enabled);
                    return entityDetails(world, registry, request.entity);
                });
            case "renameEntity":
                return this.edit([request.entity], () => {
                    renameEntity(world, request.entity, request.name);
                    return entityDetails(world, registry, request.entity);
                });
            case "setParent":
                return this.inGameView(() => {
                    const previous = parentOf(world, requireSceneEntity(world, request.entity));
                    const sceneBefore = this.membership.rootSceneOf(request.entity);
                    return this.edit([previous, request.parent ?? undefined, request.entity], () => {
                        setParent(world, request.entity, request.parent, request.siblingIndex);
                        if (request.parent === null) this.membership.placeRoot(request.entity, sceneBefore);
                        return entityDetails(world, registry, request.entity);
                    });
                });
            case "duplicateEntities":
                return this.inGameView(() => {
                    const parents = request.entities.map(entity => parentOf(world, requireSceneEntity(world, entity)));
                    return this.edit(parents, () => ({roots: duplicateEntities(world, registry, this.assets, request.entities)}), result => result.roots);
                });
            case "serializeEntities":
                return this.inGameView(() => {
                    const saved = serializeEntities(world, registry, request.entities.map(entity => requireSceneEntity(world, entity)));
                    return {documentText: documentText(saved.document), report: saved.report};
                });
            case "instantiateEntities":
                return this.instantiateEntities(request);
            case "getPrefabOverrides":
                return this.inGameView(() => this.prefabs.overridesOf(request.entity));
            case "revertPrefabInstance":
                return this.inGameView(() => {
                    const scenes = this.scenesOf([request.entity]);
                    const reverted = this.prefabs.revert(request.entity, request.paths);
                    this.markScenesEdited(scenes);
                    return reverted;
                });
            case "applyPrefabInstance":
                return this.inGameView(() => {
                    const applied = {documentText: documentText(this.prefabs.apply(request.entity))};
                    this.markScenesEdited(this.scenesOf([request.entity]));
                    return applied;
                });
            case "updatePrefabInstances": {
                const document = parseSceneDocument(request.documentText);
                await this.preloadDocument(document);
                return this.inGameView(() => ({updated: this.prefabs.update(request.sourcePath, document)}));
            }
            case "pickEntities":
                return this.inGameView(() => ({entities: this.views.pick(request.x, request.y, request.view)}));
            case "setView":
                return this.inGameView(() => {
                    if (request.view === "scene" && this._mode === "play") {
                        throw new Error("The Scene view is not available while the game plays; pause first");
                    }
                    this.views.setView(request.view);
                    return {view: this.views.view};
                });
            case "setEditorCamera":
                return this.inGameView(() => {
                    this.views.setEditorCamera(request.position, request.rotation, request.fieldOfViewDegrees);
                    return this.views.viewInfo("scene", NO_ENTITIES);
                });
            case "getViewInfo":
                return this.inGameView(() => this.views.viewInfo(request.view, request.entities ?? NO_ENTITIES));
            case "saveScene":
                return this.inGameView(() => this.saveScene(request.scene));
            case "loadScene":
                return await this.loadScene(request);
            case "unloadScene":
                return this.inGameView(() => this.unloadScene(request.sceneId));
            case "setActiveScene":
                return this.inGameView(() => this.setActiveScene(request.scene));
            case "exportSnapshot":
                return this.inGameView(() => this.exportSnapshot());
            case "importSnapshot":
                return await this.importSnapshot(request);
            case "setMode":
                return this.inGameView(() => this.changeMode(() => this.setMode(request.mode)));
            case "step":
                return this.inGameView(() => this.changeMode(() => this.step()));
            case "describeAssetTypes":
                return describeAssetTypes(registry);
            case "getTickStats":
                return {ticks: this.tickCount, tickMsTotal: this.tickMsTotal, timeMs: performance.now()};
            case "listSettings":
                return this.inGameView(() => listSettings(world, registry));
            case "getResource":
                return this.inGameView(() => resourceDetails(world, registry, request.typeName));
            case "setResourceField":
                return this.setResourceField(request);
            case "reloadDataAsset":
                return this.reloadDataAsset(request.path);
            case "defaultResourceFields":
                return {fields: defaultResourceFields(registry, request.typeName)};
        }
    }

    private reportDataAssetSchemaChanges(): void {
        const dataAssets = this.world.resources.tryGet(DataAssets);
        if (dataAssets === undefined) return;
        for (const report of dataAssets.schemaChangeReports()) warnDataAssetSchemaChanges(report);
        dataAssets.onSchemaChanged.add(this.onDataAssetSchemaChanged);
    }

    private async reloadDataAsset(path: string): Promise<ReloadDataAssetResult> {
        const dataAssets = this.world.resources.tryGet(DataAssets);
        if (dataAssets === undefined || !dataAssets.isLoaded(path)) return {reloaded: false};
        await this.options.refetchFiles?.([path]);
        const asset = dataAssets.reload(path);
        if (asset === undefined) return {reloaded: false};
        this.keepReloadedResourceInSnapshot(asset);
        return {reloaded: true};
    }

    private keepReloadedResourceInSnapshot(asset: Resource): void {
        const snapshot = this.snapshot;
        const resources = snapshot?.document.resources;
        const schema = this.registry.resourceByCtor(asset.constructor as ResourceCtor<Resource>);
        if (snapshot === undefined || resources === undefined || schema === undefined || resources[schema.name] === undefined) return;
        if (this.world.resources.tryGet(schema.ctor) !== asset) return;
        const fields = encodeDataAssetFields(this.registry, asset);
        this.snapshot = {...snapshot, document: {...snapshot.document, resources: {...resources, [schema.name]: fields}}};
    }

    private async setResourceField(request: SetResourceFieldRequest): Promise<SetFieldResult> {
        if (this._mode === "edit") {
            throw new Error(`${request.typeName} is read-only while editing: resources are live game state, so edit them while the game plays or is paused`);
        }
        await this.preload(resourceFieldAssetReferences(this.registry, request));
        return this.inGameView(() => ({value: assignResourceField(this.world, this.registry, this.assets, request)}));
    }

    private async instantiateEntities(request: InstantiateEntitiesRequest): Promise<InstantiateEntitiesResult> {
        const document = withoutSceneMembership(parseSceneDocument(request.documentText));
        await this.preloadDocument(document);
        return this.inGameView(() => {
            const parent = request.parent ?? null;
            if (parent !== null) requireSceneEntity(this.world, parent);
            const instantiated = this.edit([parent ?? undefined], () => {
                const created = request.prefabSourcePath !== undefined
                    ? this.prefabs.instantiate(document, request.prefabSourcePath, parent, request.siblingIndex)
                    : instantiateDocument(this.world, this.registry, document, {
                        assets: this.assets,
                        parent,
                        siblingIndex: request.siblingIndex,
                        unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
                        schemaChanges: REPORTED_SCHEMA_CHANGES,
                    });
                if (parent === null && request.scene !== undefined) for (const root of created.roots) this.membership.placeRoot(root, request.scene);
                return {roots: created.roots, entities: created.entities, report: created.report};
            });
            this.markScenesEdited(this.scenesOf(instantiated.roots));
            return instantiated;
        });
    }

    private listEntities(): ListEntitiesResult {
        return {
            entities: entitySummaries(this.world, this.registry, this.membership.sceneLookup()),
            scenes: this.membership.loadedScenes(),
            activeSceneId: this.membership.activeSceneId(),
            editedSceneIds: [...this.editedScenes],
        };
    }

    private savedDocument(document: SceneDocument): string {
        return documentText(withoutDataAssetResources(this.world, this.registry, withoutSceneMembership(document)));
    }

    private saveWorld(sceneId: number): SaveSceneResult {
        const saved = serializeWorld(this.world, this.registry);
        return {sceneText: this.savedDocument(saved.document), report: saved.report, sceneId};
    }

    private saveScene(scene: EditorSceneRef | undefined): SaveSceneResult {
        if (scene === undefined) return this.saveWorld(this.membership.activeSceneId());
        const sceneId = this.savedSceneId(scene);
        this.editedScenes.delete(scene.id);
        this.editedScenes.delete(sceneId);
        const roots = this.membership.memberRoots(sceneId);
        if (roots.length === sceneRoots(this.world).length) return this.saveWorld(sceneId);
        const saved = serializeSceneRoots(this.world, this.registry, roots, sceneId === this.membership.activeSceneId());
        return {sceneText: this.savedDocument(saved.document), report: saved.report, sceneId};
    }

    private savedSceneId(scene: EditorSceneRef): number {
        const path = scene.path ?? undefined;
        const loaded = this.membership.loadedScene(scene.id);
        if (loaded !== undefined) {
            if (loaded.path !== path) this.membership.renameScene(loaded.id, path);
            return loaded.id;
        }
        const holdsUnsavedRoots = scene.id === NO_SCENE_ID && this.scenes.active() === undefined && this.membership.untaggedRoots().length > 0;
        return holdsUnsavedRoots ? this.membership.createActiveScene(path).id : scene.id;
    }

    private unloadScene(sceneId: number): UnloadSceneResult {
        this.requireEditing("unload a scene");
        this.membership.adoptUntaggedRoots();
        const loaded = this.membership.loadedScene(sceneId);
        if (loaded !== undefined) this.scenes.unload(loaded);
        this.editedScenes.delete(sceneId);
        return {activeSceneId: this.membership.activeSceneId()};
    }

    private setActiveScene(scene: EditorSceneRef): SetActiveSceneResult {
        this.requireEditing("change the active scene");
        this.membership.adoptUntaggedRoots();
        const loaded = this.membership.loadedScene(scene.id);
        if (loaded === undefined) return {sceneId: this.membership.createActiveScene(scene.path ?? undefined).id};
        this.scenes.setActive(loaded);
        return {sceneId: loaded.id};
    }

    private exportSnapshot(): ExportSnapshotResult {
        return exportWorldSnapshot(this.world, this.registry, {mode: this._mode, gameplayTicks: this.gameplayTicks, editSnapshot: this.snapshot});
    }

    private abandonPlay(): void {
        this.snapshot = undefined;
        this.stop();
        this.discardPendingCommands();
    }

    private replaceWorldWith(document: SceneDocument): SceneLoadResult {
        this.abandonPlay();
        const previous = entitiesInCreationOrder(this.world);
        const loaded = deserializeInto(this.world, this.registry, document, {
            assets: this.assets,
            unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
            schemaChanges: REPORTED_SCHEMA_CHANGES,
        });
// Old entities go only after the new document loaded, so a bad document leaves the scene as it was.
        destroyAllEntities(this.world, previous);
        this.editedScenes.clear();
        this.clearWorldStop();
        return loaded;
    }

    private async loadScene(request: LoadSceneRequest): Promise<LoadSceneResult> {
        const document = parseSceneDocument(request.sceneText);
        if (request.additive === true) this.requireEditing("add a scene");
        await this.preloadDocument(document);
        if (request.additive === true) return this.inGameView(() => this.addScene(document, request.path));
        return this.inGameView(() => this.changeMode(() => {
            this.abandonPlay();
            const loaded = this.scenes.loadDocument(document, {
                mode: OPENED_SCENE_MODE,
                persistentEntities: OPENED_SCENE_PERSISTENT_ENTITIES,
                path: request.path,
            });
            this.editedScenes.clear();
            this.clearWorldStop();
            return {entityCount: loaded.entities.length, report: loaded.report, sceneId: loaded.handle.id};
        }));
    }

    private addScene(document: SceneDocument, path: string | undefined): LoadSceneResult {
        this.requireEditing("add a scene");
        this.membership.adoptUntaggedRoots();
        const loaded = this.scenes.loadDocument(document, {mode: ADDED_SCENE_MODE, path});
        return {entityCount: loaded.entities.length, report: loaded.report, sceneId: loaded.handle.id};
    }

    private async importSnapshot(request: ImportSnapshotRequest): Promise<ImportSnapshotResult> {
        const document = parseSceneDocument(request.documentText);
        const editDocument = request.editSnapshotText === undefined ? undefined : parseSceneDocument(request.editSnapshotText);
        await this.preloadDocument(document);
        if (editDocument !== undefined) await this.preloadDocument(editDocument);
        return this.inGameView(() => this.changeMode(() => {
            const loaded = this.replaceWorldWith(document);
            if (request.mode === "play") this.play();
            else if (request.mode === "paused") this.pause();
            if (request.mode !== "edit" && editDocument !== undefined) {
                this.snapshot = importedEditSnapshot(editDocument, request.editSnapshotRecords, loaded.entities);
            }
            this.tickCounter.ticks = request.gameplayTicks ?? 0;
            return {entities: loaded.entities, report: loaded.report};
        }));
    }

    private state(): EditorServiceState {
        return {mode: this._mode, gameplayTicks: this.gameplayTicks, view: this.views.view, worldStoppedError: this.stoppedError ?? null};
    }

    private changeMode<T>(action: () => T): T {
        try {
            return action();
        } finally {
            this.postEvent({kind: "modeChanged", mode: this._mode, gameplayTicks: this.gameplayTicks, view: this.views.view});
        }
    }

    private setMode(mode: EditorMode): EditorServiceState {
        switch (mode) {
            case "edit":
                this.stop();
                break;
            case "play":
                this.play();
                break;
            case "paused":
                this.pause();
                break;
        }
        return this.state();
    }

    private requireRunningWorld(action: string): void {
        if (this.stoppedError !== undefined) {
            throw new Error(`Cannot ${action}: the world stopped (${this.stoppedError}); load a scene or import a snapshot to reset it`);
        }
    }

    private leaveEditMode(): void {
        if (this._mode !== "edit") return;
        this.membership.adoptUntaggedRoots();
        this.snapshot = serializeWorld(this.world, this.registry);
        this.viewBeforePlay = this.views.view;
    }

    private play(): void {
        this.requireRunningWorld("play");
        if (this._mode === "play") return;
        this.leaveEditMode();
        this.gate.resume();
        this.views.setView("game");
        this._mode = "play";
        this.lastPlayTickMs = performance.now() - this.tickIntervalMs();
    }

    private pause(): void {
        if (this._mode === "paused") return;
        this.leaveEditMode();
        this.gate.suspend();
        this._mode = "paused";
    }

    private stop(): void {
        if (this._mode === "edit") return;
        this.gate.suspend();
        this.discardPendingCommands();
        this._mode = "edit";
        this.tickCounter.ticks = 0;
        const snapshot = this.snapshot;
        this.snapshot = undefined;
        if (snapshot !== undefined) applySceneInPlace(this.world, this.registry, snapshot, {assets: this.assets, schemaChanges: REPORTED_SCHEMA_CHANGES});
        if (this.viewBeforePlay !== undefined) this.views.setView(this.viewBeforePlay);
        this.viewBeforePlay = undefined;
    }

    private step(): EditorServiceState {
        this.requireRunningWorld("step");
        this.pause();
        this.gate.resume();
        try {
            this.world.step();
        } catch (error) {
            this.worldStopped(error);
            throw new Error(`The step failed and the world stopped: ${errorText(error)}`);
        } finally {
            this.gate.suspend();
        }
        return this.state();
    }

    private discardPendingCommands(): void {
        this.world.tryGetSystem(EntityCommandBufferSystem)?.getEntityCommandBuffer().discard();
    }

    private worldStopped(error: unknown): void {
        if (this.stoppedError !== undefined) return;
        this.stoppedError = error === undefined ? PLAIN_STOP_TEXT : errorText(error);
        this.stopTicking();
        this.postEvent({kind: "worldStopped", error: this.stoppedError});
    }

    private clearWorldStop(): void {
        if (this.stoppedError === undefined) return;
        this.stoppedError = undefined;
        this.startTicking();
    }

    private startTicking(): void {
        if (this.ticker !== undefined) return;
        this.ticker = setInterval(() => this.tick(), this.tickIntervalMs());
    }

    private tickIntervalMs(): number {
        return this.options.tickIntervalMs ?? this.world.loopTiming.tickDeltaMs;
    }

    private stopTicking(): void {
        if (this.ticker === undefined) return;
        clearInterval(this.ticker);
        this.ticker = undefined;
    }

    private tick(): void {
        if (this.stoppedError !== undefined) return;
        const playing = this._mode === "play";
        const startedMs = performance.now();
        try {
            this.views.apply();
            if (playing) {
                this.gate.resume();
                const now = performance.now();
                const deltaTimeMs = now - this.lastPlayTickMs;
                this.lastPlayTickMs = now;
                this.world.step(deltaTimeMs);
            } else {
                this.gate.suspend();
                this.world.step();
            }
            this.tickCount++;
            this.tickMsTotal += performance.now() - startedMs;
        } catch (error) {
            console.error(`Editor: the ${this._mode} tick failed, so the editor stopped ticking the world: ${errorText(error)}`);
            this.worldStopped(error);
        }
    }
}

export function attachEditorWorldService(
    scope: EditorServiceScope,
    world: World,
    registry: ComponentSchemaRegistry,
    options: EditorWorldServiceOptions = {},
): EditorWorldService {
    const service = new EditorWorldService(scope, world, registry, options);
    service.attach();
    return service;
}
