import type {World} from "../../engine/core";
import {
    applySceneInPlace,
    deserializeInto,
    parseSceneDocument,
    platformSceneAssetLoader,
    sceneAssetPaths,
    serializeWorld,
} from "../../engine/scene";
import type {ComponentSchemaRegistry, SceneAssetLoader, SceneJsonObject, SceneSnapshot} from "../../engine/scene";
import {EDITOR_MESSAGE_TYPE, isEditorRequestMessage, requestIdOfMalformedEditorRequest} from "../editorProtocol";
import type {
    EditorMode,
    EditorPlayState,
    EditorRequest,
    EditorRequestMessage,
    EditorResponseMessage,
    EditorResult,
    LoadSceneResult,
    SaveSceneResult,
} from "../editorProtocol";
import {GameplaySystemGate, GameplayTickCounterSystem} from "./gameplaySystemGate";
import {describeSchemas, entitiesInCreationOrder, entityDetails, listEntities} from "./entityInspection";
import {
    addComponentTo,
    assetPathsOf,
    assignField,
    createEditorEntity,
    destroyAllEntities,
    destroyWithDescendants,
    removeComponentFrom,
    setEntityEnabled,
} from "./entityEditing";

export interface EditorServiceScope {
    postMessage(message: EditorResponseMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export interface EditorWorldServiceOptions {
    readonly preloadAssets?: (paths: readonly string[]) => Promise<void>;
}

const SCENE_TEXT_INDENT_SPACES = 2;
const NO_VALUES: SceneJsonObject = {};

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class EditorWorldService {
    private _mode: EditorMode = "edit";
    private snapshot: SceneSnapshot | undefined;
    private ticker: ReturnType<typeof setInterval> | undefined;
    private pendingRequests: Promise<void> = Promise.resolve();
    private attached = true;
    private readonly gate: GameplaySystemGate;
    private readonly tickCounter: GameplayTickCounterSystem;
    private readonly assets: SceneAssetLoader;

    public constructor(
        private readonly scope: EditorServiceScope,
        private readonly world: World,
        private readonly registry: ComponentSchemaRegistry,
        private readonly options: EditorWorldServiceOptions,
    ) {
        this.gate = new GameplaySystemGate(world);
        this.tickCounter = world.getOrCreateSystem(GameplayTickCounterSystem);
        this.assets = platformSceneAssetLoader(world.platform);
    }

    public get mode(): EditorMode {
        return this._mode;
    }

    public get gameplayTicks(): number {
        return this.tickCounter.ticks;
    }

    public attach(): void {
        this.world.pause();
        this.gate.suspend();
        this.startTicking();
        this.scope.addEventListener("message", event => this.receive(event.data));
    }

    public detach(): void {
        this.attached = false;
        this.stopTicking();
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

    private post(message: EditorResponseMessage): void {
        if (this.attached) this.scope.postMessage(message);
    }

    private async perform(request: EditorRequest): Promise<EditorResult> {
        const {world, registry} = this;
        switch (request.op) {
            case "describeSchemas":
                return describeSchemas(registry);
            case "listEntities":
                return listEntities(world, registry);
            case "getEntity":
                return entityDetails(world, registry, request.entity);
            case "setField":
                await this.preload(assetPathsOf(registry, request.typeName, {[request.key]: request.value}));
                return {value: assignField(world, registry, this.assets, request.entity, request.typeName, request.key, request.value)};
            case "addComponent": {
                const values = request.values ?? NO_VALUES;
                await this.preload(assetPathsOf(registry, request.typeName, values));
                addComponentTo(world, registry, this.assets, request.entity, request.typeName, values);
                return entityDetails(world, registry, request.entity);
            }
            case "removeComponent":
                removeComponentFrom(world, registry, request.entity, request.typeName);
                return entityDetails(world, registry, request.entity);
            case "createEntity":
                return entityDetails(world, registry, createEditorEntity(world, request.name, request.parent));
            case "destroyEntity":
                return {destroyed: destroyWithDescendants(world, request.entity)};
            case "setEnabled":
                setEntityEnabled(world, request.entity, request.enabled);
                return entityDetails(world, registry, request.entity);
            case "saveScene":
                return this.saveScene();
            case "loadScene":
                return await this.loadScene(request.sceneText);
            case "setMode":
                return this.setMode(request.mode);
            case "step":
                return this.step();
        }
    }

    private async preload(paths: readonly string[]): Promise<void> {
        if (paths.length > 0 && this.options.preloadAssets !== undefined) await this.options.preloadAssets(paths);
    }

    private saveScene(): SaveSceneResult {
        const saved = serializeWorld(this.world, this.registry);
        return {sceneText: JSON.stringify(saved.document, null, SCENE_TEXT_INDENT_SPACES), report: saved.report};
    }

    private async loadScene(sceneText: string): Promise<LoadSceneResult> {
        const document = parseSceneDocument(sceneText);
        this.stop();
        await this.preload(sceneAssetPaths(document, this.registry).map(reference => reference.path));
        const previous = entitiesInCreationOrder(this.world);
        const loaded = deserializeInto(this.world, this.registry, document, {assets: this.assets, unknownComponentTypes: "skip"});
        destroyAllEntities(this.world, previous);
        return {entityCount: loaded.entities.length, report: loaded.report};
    }

    private playState(): EditorPlayState {
        return {mode: this._mode, gameplayTicks: this.gameplayTicks};
    }

    private setMode(mode: EditorMode): EditorPlayState {
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
        return this.playState();
    }

    private takeSnapshotIfEditing(): void {
        if (this._mode === "edit") this.snapshot = serializeWorld(this.world, this.registry);
    }

    private play(): void {
        if (this._mode === "play") return;
        this.takeSnapshotIfEditing();
        this.stopTicking();
        this.gate.resume();
        this._mode = "play";
        this.world.startLoop();
    }

    private pause(): void {
        if (this._mode === "paused") return;
        this.takeSnapshotIfEditing();
        if (this._mode === "play") {
            this.world.pause();
            this.gate.suspend();
            this.startTicking();
        }
        this._mode = "paused";
    }

    private stop(): void {
        if (this._mode === "edit") return;
        this.world.pause();
        this.gate.suspend();
        this.startTicking();
        this._mode = "edit";
        this.tickCounter.ticks = 0;
        const snapshot = this.snapshot;
        this.snapshot = undefined;
        if (snapshot !== undefined) applySceneInPlace(this.world, this.registry, snapshot, {assets: this.assets});
    }

    private step(): EditorPlayState {
        this.pause();
        this.gate.resume();
        try {
            this.world.step();
        } finally {
            this.gate.suspend();
        }
        return this.playState();
    }

    private startTicking(): void {
        if (this.ticker !== undefined) return;
        this.ticker = setInterval(() => this.tick(), this.world.targetDeltaTimeMs);
    }

    private stopTicking(): void {
        if (this.ticker === undefined) return;
        clearInterval(this.ticker);
        this.ticker = undefined;
    }

    private tick(): void {
        this.gate.suspend();
        try {
            this.world.step();
        } catch (error) {
            this.stopTicking();
            console.error(`Editor: the ${this._mode} tick failed, so the editor stopped ticking the world: ${errorText(error)}`);
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
