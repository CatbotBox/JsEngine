import {EntityCommandBufferSystem} from "../../engine/core";
import type {Entity, World, WorldStoppedEvent} from "../../engine/core";
import {
    applySceneInPlace,
    deserializeInto,
    parseSceneDocument,
    platformSceneAssetLoader,
    sceneAssetPaths,
    serializeEntities,
    serializeWorld,
    instantiateDocument,
} from "../../engine/scene";
import type {ComponentSchemaRegistry, SceneAssetLoader, SceneDocument, SceneJsonObject, SceneLoadResult, SceneSnapshot} from "../../engine/scene";
import {EDITOR_MESSAGE_TYPE, isEditorRequestMessage, requestIdOfMalformedEditorRequest} from "../editorProtocol";
import type {
    EditorEvent,
    EditorMode,
    EditorRequest,
    EditorRequestMessage,
    EditorResponseMessage,
    EditorResult,
    EditorServiceState,
    EditorView,
    EditorWorldMessage,
    ExportSnapshotResult,
    ImportSnapshotRequest,
    ImportSnapshotResult,
    InstantiateEntitiesRequest,
    InstantiateEntitiesResult,
    LoadSceneResult,
    SaveSceneResult,
} from "../editorProtocol";
import {GameplaySystemGate, GameplayTickCounterSystem} from "./gameplaySystemGate";
import {describeSchemas, entitiesInCreationOrder, entityDetails, listEntities, parentOf, requireSceneEntity} from "./entityInspection";
import {
    addComponentTo,
    assetPathsOf,
    assetPathsOfEdits,
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

export interface EditorServiceScope {
    postMessage(message: EditorWorldMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface EditorWorldServiceOptions {
    readonly preloadAssets?: (paths: readonly string[]) => Promise<void>;
    readonly tickIntervalMs?: number;
}

const SCENE_TEXT_INDENT_SPACES = 2;
const NO_VALUES: SceneJsonObject = {};
const NO_ENTITIES: readonly Entity[] = [];
const PLAIN_STOP_TEXT = "The world was stopped";
const SKIPPED_UNKNOWN_TYPES = "skip";
const REPORTED_SCHEMA_CHANGES = "report";

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
    private pendingRequests: Promise<void> = Promise.resolve();
    private attached = true;
    private stoppedError: string | undefined;
    private readonly gate: GameplaySystemGate;
    private readonly tickCounter: GameplayTickCounterSystem;
    private readonly assets: SceneAssetLoader;
    private readonly views: EditorViews;
    private readonly prefabs: PrefabLibrary;
    private readonly consoleForwarder: ConsoleForwarder;
    private readonly onWorldStopped = (event: WorldStoppedEvent) => this.worldStopped(event.error);

    public constructor(
        private readonly scope: EditorServiceScope,
        private readonly world: World,
        private readonly registry: ComponentSchemaRegistry,
        private readonly options: EditorWorldServiceOptions,
    ) {
        this.gate = new GameplaySystemGate(world);
        this.tickCounter = world.getOrCreateSystem(GameplayTickCounterSystem);
        this.assets = platformSceneAssetLoader(world.platform);
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
        this.views.apply();
        this.startTicking();
        this.scope.addEventListener("message", event => this.receive(event.data));
    }

    public detach(): void {
        this.attached = false;
        this.stopTicking();
        this.world.onStopped.remove(this.onWorldStopped);
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
            const result = action();
            this.prefabs.refreshAround(liveOnly(this.world, [...touched, ...touchedAfter(result)]));
            return result;
        });
    }

    private async preload(paths: readonly string[]): Promise<void> {
        if (paths.length > 0 && this.options.preloadAssets !== undefined) await this.options.preloadAssets(paths);
    }

    private async preloadDocument(document: SceneDocument): Promise<void> {
        await this.preload(sceneAssetPaths(document, this.registry).map(reference => reference.path));
    }

    private async perform(request: EditorRequest): Promise<EditorResult> {
        const {world, registry} = this;
        switch (request.op) {
            case "describeSchemas":
                return this.inGameView(() => describeSchemas(world, registry));
            case "listEntities":
                return this.inGameView(() => listEntities(world, registry));
            case "getEntity":
                return this.inGameView(() => entityDetails(world, registry, request.entity));
            case "setField":
                await this.preload(assetPathsOf(registry, request.typeName, {[request.key]: request.value}));
                return this.edit([request.entity], () => ({value: assignField(world, registry, this.assets, request)}));
            case "setFields":
                await this.preload(assetPathsOfEdits(registry, request.edits));
                return this.edit(request.edits.map(edit => edit.entity), () => ({values: assignFields(world, registry, this.assets, request.edits)}));
            case "addComponent": {
                const values = request.values ?? NO_VALUES;
                await this.preload(assetPathsOf(registry, request.typeName, values));
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
                return this.edit([request.parent], () => entityDetails(world, registry, createEditorEntity(world, request.name, request.parent)));
            case "destroyEntity":
                return this.inGameView(() => {
                    const parent = parentOf(world, requireSceneEntity(world, request.entity));
                    return this.edit([parent], () => ({destroyed: destroyWithDescendants(world, request.entity)}));
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
                    return this.edit([previous, request.parent ?? undefined, request.entity], () => {
                        setParent(world, request.entity, request.parent, request.siblingIndex);
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
                return this.inGameView(() => this.prefabs.revert(request.entity, request.paths));
            case "applyPrefabInstance":
                return this.inGameView(() => ({documentText: documentText(this.prefabs.apply(request.entity))}));
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
                return this.inGameView(() => this.saveScene());
            case "loadScene":
                return await this.loadScene(request.sceneText);
            case "exportSnapshot":
                return this.inGameView(() => this.exportSnapshot());
            case "importSnapshot":
                return await this.importSnapshot(request);
            case "setMode":
                return this.inGameView(() => this.changeMode(() => this.setMode(request.mode)));
            case "step":
                return this.inGameView(() => this.changeMode(() => this.step()));
        }
    }

    private async instantiateEntities(request: InstantiateEntitiesRequest): Promise<InstantiateEntitiesResult> {
        const document = parseSceneDocument(request.documentText);
        await this.preloadDocument(document);
        return this.inGameView(() => {
            const parent = request.parent ?? null;
            if (parent !== null) requireSceneEntity(this.world, parent);
            return this.edit([parent ?? undefined], () => {
                const created = request.prefabSourcePath !== undefined
                    ? this.prefabs.instantiate(document, request.prefabSourcePath, parent, request.siblingIndex)
                    : instantiateDocument(this.world, this.registry, document, {
                        assets: this.assets,
                        parent,
                        siblingIndex: request.siblingIndex,
                        unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
                        schemaChanges: REPORTED_SCHEMA_CHANGES,
                    });
                return {roots: created.roots, entities: created.entities, report: created.report};
            });
        });
    }

    private saveScene(): SaveSceneResult {
        const saved = serializeWorld(this.world, this.registry);
        return {sceneText: documentText(saved.document), report: saved.report};
    }

    private exportSnapshot(): ExportSnapshotResult {
        return exportWorldSnapshot(this.world, this.registry, {mode: this._mode, gameplayTicks: this.gameplayTicks, editSnapshot: this.snapshot});
    }

    private replaceWorldWith(document: SceneDocument): SceneLoadResult {
        this.snapshot = undefined;
        this.stop();
        this.discardPendingCommands();
        const previous = entitiesInCreationOrder(this.world);
        const loaded = deserializeInto(this.world, this.registry, document, {
            assets: this.assets,
            unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
            schemaChanges: REPORTED_SCHEMA_CHANGES,
        });
// Old entities go only after the new document loaded, so a bad document leaves the scene as it was.
        destroyAllEntities(this.world, previous);
        this.clearWorldStop();
        return loaded;
    }

    private async loadScene(sceneText: string): Promise<LoadSceneResult> {
        const document = parseSceneDocument(sceneText);
        await this.preloadDocument(document);
        return this.inGameView(() => this.changeMode(() => {
            const loaded = this.replaceWorldWith(document);
            return {entityCount: loaded.entities.length, report: loaded.report};
        }));
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
