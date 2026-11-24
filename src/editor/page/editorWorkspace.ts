import type {Entity} from "../../engine/core";
import {errorFramesOf} from "../../engine/debugging/errorStack";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import {parseSceneDocument, sceneDocumentText} from "../../engine/scene/sceneDocument";
import {withoutSceneMembership} from "../../engine/scene";
import type {SceneJsonObject, SceneJsonValue} from "../../engine/scene";
import type {
    EditorAssetTypeDescription,
    EditorComponentDescription,
    EditorComponentDetails,
    EditorConsoleLevel,
    EditorEntityDetails,
    EditorEntitySummary,
    EditorEvent,
    EditorFieldValue,
    EditorMode,
    EditorRequest,
    EditorResourceDescription,
    EditorResultOf,
    EditorServiceState,
    InstantiateEntitiesRequest,
    ListEntitiesResult,
    SetFieldResult,
    SetFieldsResult,
} from "../editorProtocol";
import {dataAssetTypeOf, filesWithSuffixes} from "./assetChoices";
import {dataAssetPathProblem, dataAssetText, isCreatableDataAssetType} from "./dataAssetDrafts";
import {EditorClientClosedError} from "./editorClient";
import type {EditorNoticeLevel, EditorSession, EntityRemap} from "./editorSession";
import {EditorRefresh} from "./editorRefresh";
import type {SelectionDetails} from "./editorRefresh";
import type {Vector3} from "./editorCameraMath";
import type {EditorTool} from "./editorTools";
import {ConsoleLog} from "./consoleLog";
import type {ConsoleAppend} from "./consoleLog";
import {askForText} from "./dialogs";
import {errorText, readStorage, writeStorage} from "./dom";
import {ENTITY_TEMPLATE_NAMES, entityTemplateProblem, entityTemplateRequest, hasPerspectiveCamera} from "./entityTemplates";
import type {EntityTemplate} from "./entityTemplates";
import {entitySummaryLabel} from "./entityTree";
import {isInlineAssetSummary} from "./fieldValueText";
import {
    extractedImagePath,
    extractedImagePathProblem,
    imageExtraction,
    imageExtractionCommand,
    imageFileFormatOf,
    patternFilePathOf,
    patternInlining,
} from "./imageExtraction";
import {parentLookupOf, planMoves, siblingIndexIn, siblingListsOf, subtreeInListOrder, topmostEntities} from "./hierarchyDrop";
import type {DropTarget, HierarchyLink} from "./hierarchyDrop";
import {
    documentRootCount,
    prefabInstanceRootOf,
    withoutPrefabInstances,
} from "./prefabInstancePaths";
import {
    allProjectPaths,
    fileNameProblem,
    isImageKind,
    normalizeProjectPath,
    PREFAB_EXTENSION,
    projectFileKind,
    stemOf,
    uniqueChildPath,
} from "./projectFiles";
import type {ProjectFileKind} from "./projectFiles";
import type {ProjectEntry} from "../project/projectFileSystem";
import {FileExistenceCommand, newFileSnapshot, ObservedProjectFiles} from "./fileUndo";
import {GAME_VIEW_OPTIONS_STORAGE_KEY, gameViewOptionsText, isLayoutMaximized, parseGameViewOptions, withGameViewOption} from "./gameViewOptions";
import type {GameViewOptionChoice, GameViewOptions} from "./gameViewOptions";
import {HANDLE_MODES_STORAGE_KEY, handleModesText, parseHandleModes} from "./handleModes";
import type {HandleModes} from "./handleModes";
import {SceneDocuments} from "./sceneDocuments";
import type {StackMapper} from "./stackMapper";
import type {TabHistory} from "./sceneDocuments";
import {parseSnapEnabled, parseSnapSteps, SNAP_ENABLED_STORAGE_KEY, SNAP_STEPS_STORAGE_KEY, snapStepsText, withSnapStep} from "./snapSteps";
import type {SnapStepChoice, SnapSteps} from "./snapSteps";
import {
    ComponentPresenceCommand,
    CompositeCommand,
    EnabledCommand,
    EntityRefs,
    entityValueShapeOf,
    HOLDS_NO_ENTITIES,
    ExistenceCommand,
    FieldsCommand,
    recordSubtree,
    RenameCommand,
    SiblingOrderCommand,
    storedValuesOf,
    UndoStack,
} from "./undoStack";
import type {EditorRequester, EntityValueShape, FieldChange, RecordedSubtree, StoredValues, UndoCommand, UndoContext} from "./undoStack";

export type WorkspaceTopic = "entities" | "selection" | "details" | "state" | "schemas" | "status" | "document" | "sceneLoaded" | "reveal" | "inspectedFile" | "entityPick" | "openDataAsset" | "files" | "handles" | "gameCamera";

export type DragPayload =
    | {readonly kind: "entities", readonly entities: readonly Entity[]}
    | {readonly kind: "asset", readonly path: string, readonly fileKind: ProjectFileKind, readonly movedPaths: readonly string[]};

export interface AssetPlacement {
    readonly target: DropTarget;
    readonly position?: Vector3;
}

export interface ComponentValuesClipboard {
    readonly typeName: string;
    readonly values: SceneJsonObject;
}

export interface WorkspaceStatus {
    readonly level: EditorNoticeLevel;
    readonly text: string;
}

export const DEFAULT_ENTITY_NAME = "Entity";
export const ERROR_REPEAT_SUPPRESSION_MS = 5000;

const NOTICE_CONSOLE_LEVELS: Readonly<Record<EditorNoticeLevel, EditorConsoleLevel>> = {info: "info", warn: "warn", error: "error"};
const LOCAL_POSITION_TYPE_NAME = "LocalPosition";
const LOCAL_POSITION_KEY = "xyz";
const RENDER_MESH_TYPE_NAME = "RenderMesh";
const RENDER_MESH_KEY = "mesh";
const SPRITE_TYPE_NAME = "Sprite";
const SPRITE_KEY = "image";
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/g;
const SAFE_REPLACEMENT = "_";
const NO_VALUES: SceneJsonObject = {};
const ENTITY_PICK_HINT = "Click an entity in the Scene view to pick it (Esc cancels)";
const ENTITY_PICK_SCENE_VIEW_HINT = "The Scene view is hidden while the game view is maximized: stop the game and click an entity in the Scene view to pick it (Esc cancels)";
const CANCEL_KEY = "Escape";
const DATA_ASSETS_FOLDER = "assets";

interface EntityPick {
    finish(entity: Entity | undefined): void;
}

type ServiceStateUpdate = Pick<EditorServiceState, "mode" | "gameplayTicks"> & {readonly worldStoppedError?: string | null};

function changedPathsOfKind(paths: readonly string[], kind: ProjectFileKind): string[] {
    return [...new Set(paths.map(normalizeProjectPath))].filter(path => projectFileKind(path) === kind);
}

function samePosition(a: SceneJsonValue, b: Vector3): boolean {
    return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function sendableValue(value: EditorFieldValue): SceneJsonValue | undefined {
    return isInlineAssetSummary(value) ? undefined : value as SceneJsonValue;
}

export function safeFileStem(name: string): string {
    const replaced = name.replace(UNSAFE_FILE_NAME_CHARACTERS, SAFE_REPLACEMENT).trim();
    return replaced.length === 0 || fileNameProblem(replaced) !== undefined ? DEFAULT_ENTITY_NAME : replaced;
}

export class EditorWorkspace implements UndoContext {
    public readonly consoleLog = new ConsoleLog();
    public readonly refresh: EditorRefresh;
    public readonly scenes: SceneDocuments;
    public readonly files: ObservedProjectFiles;
    public mode: EditorMode = "edit";
    public gameplayTicks = 0;
    public tool: EditorTool = "move";
    public snapSteps: SnapSteps;
    public snapEnabled: boolean;
    public handleModes: HandleModes;
    public gameViewOptions: GameViewOptions;
    public worldStoppedError: string | null = null;
    public gameCameraMissing = false;
    public schemas = new Map<string, EditorComponentDescription>();
    public resourceSchemas = new Map<string, EditorResourceDescription>();
    public assetTypes = new Map<string, EditorAssetTypeDescription>();
    public entities: readonly EditorEntitySummary[] = [];
    public selection: readonly Entity[] = [];
    public selectionDetails: SelectionDetails = {details: [], overrides: undefined, overridesRoot: undefined};
    public drag: DragPayload | undefined;
    public entityClipboard: string | undefined;
    public componentClipboard: ComponentValuesClipboard | undefined;
    public status: WorkspaceStatus = {level: "info", text: ""};
    public revealedPath: string | undefined;
    public inspectedFile: ProjectEntry | undefined;
    public openedDataAsset: string | undefined;
    public closed = false;
    private summaries = new Map<Entity, EditorEntitySummary>();
    private queue: Promise<void> = Promise.resolve();
    private readonly listeners = new Map<WorkspaceTopic, Set<() => void>>();
    private readonly consoleListeners = new Set<(append: ConsoleAppend) => void>();
    private unsubscribeEvents: () => void = () => undefined;
    private lastError: {readonly text: string, readonly timeMs: number} | undefined;
    private schemasRequested = false;
    private entityPick: EntityPick | undefined;

    public constructor(private currentSession: EditorSession, public readonly document: Document) {
        this.snapSteps = parseSnapSteps(readStorage(document.defaultView, SNAP_STEPS_STORAGE_KEY));
        this.snapEnabled = parseSnapEnabled(readStorage(document.defaultView, SNAP_ENABLED_STORAGE_KEY));
        this.handleModes = parseHandleModes(readStorage(document.defaultView, HANDLE_MODES_STORAGE_KEY));
        this.gameViewOptions = parseGameViewOptions(readStorage(document.defaultView, GAME_VIEW_OPTIONS_STORAGE_KEY));
        this.scenes = new SceneDocuments(this, currentSession.project.startScene, () => this.createHistory());
        this.files = new ObservedProjectFiles(() => this.currentSession.files, {
            moved: (from, to) => this.scenes.pathRenamed(from, to),
            removed: path => this.scenes.pathDeleted(path),
            changed: () => this.emit("files"),
        });
        this.refresh = new EditorRefresh({
            client: () => this.client,
            selection: () => this.selection,
            instanceRootOf: entity => prefabInstanceRootOf(entity, candidate => this.summaries.get(candidate)),
            showListing: listing => this.showListing(listing),
            showSelectionDetails: details => {
                this.selectionDetails = details;
                this.requestUnknownSchemas(details.details);
                this.emit("details");
            },
            dropMissingFromSelection: missing => this.select(this.selection.filter(entity => !missing.has(entity))),
            reportError: error => this.reportError(error),
            sessionClosed: () => this.sessionClosed(),
        });
        this.subscribeEvents();
    }

    public get client(): EditorRequester {
        return this.currentSession.client;
    }

    public get session(): EditorSession {
        return this.currentSession;
    }

    public get stackMapper(): StackMapper | undefined {
        return this.currentSession.stackMapper;
    }

    public get undo(): UndoStack {
        return this.scenes.activeTab.history.undo;
    }

    public get refs(): EntityRefs {
        return this.scenes.activeTab.history.refs;
    }

    public get recording(): boolean {
        return this.mode === "edit";
    }

    public get sceneViewShown(): boolean {
        return !isLayoutMaximized(this.gameViewOptions, this.mode);
    }

    public get primary(): Entity | undefined {
        return this.selection[this.selection.length - 1];
    }

    public get pickingEntity(): boolean {
        return this.entityPick !== undefined;
    }

    public summaryOf(entity: Entity): EditorEntitySummary | undefined {
        return this.summaries.get(entity);
    }

    public detailsOf(entity: Entity): EditorEntityDetails | undefined {
        return this.selectionDetails.details.find(details => details.entity === entity);
    }

    public links(): HierarchyLink[] {
        return this.entities.map(summary => ({entity: summary.entity, parent: summary.parent, siblingIndex: summary.siblingIndex}));
    }

    public on(topic: WorkspaceTopic, listener: () => void): () => void {
        let set = this.listeners.get(topic);
        if (set === undefined) this.listeners.set(topic, set = new Set());
        set.add(listener);
        return () => set!.delete(listener);
    }

    public onConsole(listener: (append: ConsoleAppend) => void): () => void {
        this.consoleListeners.add(listener);
        return () => this.consoleListeners.delete(listener);
    }

    public emit(topic: WorkspaceTopic): void {
        for (const listener of this.listeners.get(topic) ?? []) listener();
    }

    public log(level: EditorConsoleLevel, text: string, timeMs: number = Date.now(), stack?: string): void {
        const append = this.consoleLog.add(level, text, timeMs, stack);
        for (const listener of this.consoleListeners) listener(append);
    }

    public notice(level: EditorNoticeLevel, text: string, stack?: string): void {
        this.log(NOTICE_CONSOLE_LEVELS[level], text, Date.now(), stack);
        this.status = {level, text};
        this.emit("status");
    }

    public reportError(error: unknown): void {
        if (this.closed) return;
        if (error instanceof EditorClientClosedError) {
            this.sessionClosed();
            return;
        }
        const text = errorText(error);
        const now = Date.now();
        if (this.lastError !== undefined && this.lastError.text === text && now - this.lastError.timeMs < ERROR_REPEAT_SUPPRESSION_MS) return;
        this.lastError = {text, timeMs: now};
        this.notice("error", text, errorFramesOf(error));
    }

    public request<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        return this.client.request(request);
    }

    public run<T>(work: () => Promise<T>): Promise<T | undefined> {
        const result = this.queue.then(() => this.refresh.editing(work));
        this.queue = result.then(() => undefined, () => undefined);
        return result.catch(error => {
            this.reportError(error);
            return undefined;
        });
    }

    public whenIdle(action: () => void): void {
        this.queue = this.queue.then(action, action);
    }

    public async start(): Promise<void> {
        await this.loadSchemas();
        this.refresh.start();
    }

    public stop(): void {
        this.refresh.stop();
        this.unsubscribeEvents();
    }

    public async replaceSession(session: EditorSession, remap: EntityRemap): Promise<void> {
        this.cancelEntityPick();
        this.unsubscribeEvents();
        this.currentSession = session;
        this.closed = false;
        this.gameCameraMissing = false;
        this.subscribeEvents();
        this.refs.remap(remap);
        this.selection = this.selection.map(entity => remap.get(entity)).filter((entity): entity is Entity => entity !== undefined);
        this.selectionDetails = {details: [], overrides: undefined, overridesRoot: undefined};
        this.worldStoppedError = null;
        this.emit("selection");
        this.emit("state");
        this.emit("gameCamera");
        await this.loadSchemas();
        this.refresh.setMode(this.mode);
        this.refresh.start();
        this.refresh.refreshAll();
    }

    public async loadSchemas(): Promise<void> {
        try {
            const [described, {assetTypes}] = await Promise.all([this.request({op: "describeSchemas"}), this.request({op: "describeAssetTypes"})]);
            this.schemas = new Map(described.components.map(schema => [schema.typeName, schema]));
            this.resourceSchemas = new Map(described.resources.map(schema => [schema.typeName, schema]));
            this.assetTypes = new Map(assetTypes.map(type => [type.name, type]));
            this.emit("schemas");
        } catch (error) {
            this.reportError(error);
        }
    }

    public select(entities: readonly Entity[]): void {
        const unique = [...new Set(entities)];
        if (unique.length === this.selection.length && unique.every((entity, index) => entity === this.selection[index])) return;
        this.selection = unique;
        if (unique.length > 0) this.inspectFile(undefined);
        this.emit("selection");
        this.refresh.selectionChanged();
    }

    public inspectFile(entry: ProjectEntry | undefined): void {
        if (entry === this.inspectedFile) return;
        this.inspectedFile = entry;
        if (entry !== undefined) this.select([]);
        this.emit("inspectedFile");
    }

    public toggleSelected(entity: Entity): void {
        this.select(this.selection.includes(entity) ? this.selection.filter(selected => selected !== entity) : [...this.selection, entity]);
    }

    public setTool(tool: EditorTool): void {
        if (this.tool === tool) return;
        this.tool = tool;
        this.emit("state");
    }

    public setSnapStep(choice: SnapStepChoice): void {
        this.snapSteps = withSnapStep(this.snapSteps, choice);
        writeStorage(this.document.defaultView, SNAP_STEPS_STORAGE_KEY, snapStepsText(this.snapSteps));
        this.emit("state");
    }

    public setSnapEnabled(enabled: boolean): void {
        this.snapEnabled = enabled;
        writeStorage(this.document.defaultView, SNAP_ENABLED_STORAGE_KEY, String(enabled));
        this.emit("state");
    }

    public setHandleModes(modes: HandleModes): void {
        this.handleModes = modes;
        writeStorage(this.document.defaultView, HANDLE_MODES_STORAGE_KEY, handleModesText(modes));
        this.emit("state");
    }

    public setGameViewOption(choice: GameViewOptionChoice): void {
        this.gameViewOptions = withGameViewOption(this.gameViewOptions, choice);
        writeStorage(this.document.defaultView, GAME_VIEW_OPTIONS_STORAGE_KEY, gameViewOptionsText(this.gameViewOptions));
        this.emit("state");
    }

    public reveal(path: string): void {
        this.revealedPath = path;
        this.emit("reveal");
    }

    public worldReplaced(): void {
        this.cancelEntityPick();
        this.worldStoppedError = null;
        this.select([]);
        this.emit("sceneLoaded");
        this.emit("state");
        void this.loadSchemas();
    }

    public applyServiceState(state: ServiceStateUpdate): void {
        const modeChanged = state.mode !== this.mode;
        this.mode = state.mode;
        this.gameplayTicks = state.gameplayTicks;
        if (state.worldStoppedError !== undefined) this.worldStoppedError = state.worldStoppedError;
        this.refresh.setMode(state.mode);
        if (modeChanged && state.mode === "edit") this.refresh.refreshAll();
        if (state.mode === "play") this.cancelEntityPick();
        this.emit("state");
    }

    public pickEntity(): Promise<Entity | undefined> {
        this.cancelEntityPick();
        return new Promise(resolve => {
            const onKey = (event: KeyboardEvent): void => {
                if (event.key === CANCEL_KEY) this.cancelEntityPick();
            };
            this.document.addEventListener("keydown", onKey, true);
            this.entityPick = {
                finish: entity => {
                    this.document.removeEventListener("keydown", onKey, true);
                    this.entityPick = undefined;
                    this.emit("entityPick");
                    resolve(entity);
                },
            };
            this.emit("entityPick");
            this.notice("info", this.sceneViewShown ? ENTITY_PICK_HINT : ENTITY_PICK_SCENE_VIEW_HINT);
        });
    }

    public finishEntityPick(entity: Entity): void {
        this.entityPick?.finish(entity);
    }

    public cancelEntityPick(): void {
        this.entityPick?.finish(undefined);
    }

    public async assetChoices(assetType: string): Promise<string[]> {
        const type = this.assetTypes.get(assetType);
        if (type === undefined) return [];
        const files = this.currentSession.files;
        const paths = filesWithSuffixes(await files.list(), type.fileSuffixes);
        if (!type.dataAsset) return [...type.builtInPaths, ...paths];
        const typed = await Promise.all(paths.map(async path => {
            try {
                return dataAssetTypeOf(await files.readText(path)) === assetType ? path : undefined;
            } catch {
                return undefined;
            }
        }));
        return [...type.builtInPaths, ...typed.filter((path): path is string => path !== undefined)];
    }

    public openDataAsset(path: string): void {
        this.openedDataAsset = normalizeProjectPath(path);
        this.emit("openDataAsset");
    }

    public dataAssetTypeNames(): string[] {
        return [...this.assetTypes.values()]
            .filter(type => type.dataAsset && isCreatableDataAssetType(this.resourceSchemas.get(type.name)))
            .map(type => type.name)
            .sort((a, b) => a.localeCompare(b));
    }

    public async createDataAsset(typeName: string, path: string): Promise<boolean> {
        const created = await this.run(async () => {
            const {fields} = await this.request({op: "defaultResourceFields", typeName});
            const text = dataAssetText(typeName, fields);
            await this.files.write(path, text);
            this.record(new FileExistenceCommand(`Create ${typeName} Data Asset`, [newFileSnapshot(path, text)], true));
            this.reveal(path);
            this.openDataAsset(path);
            this.notice("info", `Created the ${typeName} data asset ${path}`);
            return true;
        });
        return created === true;
    }

    public async askAndCreateDataAsset(typeName: string, folder: string = DATA_ASSETS_FOLDER): Promise<string | undefined> {
        const existing = allProjectPaths(await this.currentSession.files.list());
        const path = await askForText(this.document, {
            title: `New ${typeName} data asset`,
            label: "File path in the project",
            initialValue: uniqueChildPath(existing, folder, typeName, DATA_ASSET_FILE_SUFFIX),
            confirmText: "Create",
            validate: value => dataAssetPathProblem(value, existing),
        });
        if (path === undefined) return undefined;
        const normalized = normalizeProjectPath(path.trim());
        return await this.createDataAsset(typeName, normalized) ? normalized : undefined;
    }

    public async reloadDataAssets(paths: readonly string[]): Promise<void> {
        for (const path of changedPathsOfKind(paths, "dataAsset")) {
            await this.run(async () => {
                const {reloaded} = await this.request({op: "reloadDataAsset", path});
                if (reloaded) this.log("info", `Reloaded the data asset ${path}`);
            });
        }
    }

    public async reloadPrefabs(paths: readonly string[]): Promise<void> {
        for (const path of changedPathsOfKind(paths, "prefab")) {
            await this.run(async () => {
                const {reloaded} = await this.request({op: "reloadPrefab", path});
                if (reloaded) this.log("info", `Reloaded the prefab ${path}`);
            });
        }
    }

    public setResourceField(typeName: string, key: string, value: SceneJsonValue): Promise<SetFieldResult | undefined> {
        return this.run(() => this.request({op: "setResourceField", typeName, key, value}));
    }

    public async setMode(mode: EditorMode): Promise<void> {
        await this.run(async () => this.applyServiceState(await this.request({op: "setMode", mode})));
    }

    public async step(): Promise<void> {
        await this.run(async () => this.applyServiceState(await this.request({op: "step"})));
    }

    public async undoLast(): Promise<void> {
        if (!this.recording) {
            this.notice("warn", "Undo is not available while the game runs; stop it first");
            return;
        }
        await this.run(async () => {
            await this.undo.undo();
        });
    }

    public async redoLast(): Promise<void> {
        if (!this.recording) {
            this.notice("warn", "Redo is not available while the game runs; stop it first");
            return;
        }
        await this.run(async () => {
            await this.undo.redo();
        });
    }

    public async jumpToHistory(depth: number): Promise<void> {
        if (!this.recording) {
            this.notice("warn", "The undo history is not available while the game runs; stop it first");
            return;
        }
        const history = this.undo;
        await this.run(async () => {
            if (this.undo === history) await history.jumpTo(depth);
        });
    }

    public endGesture(coalesceKey: string): void {
        this.whenIdle(() => this.undo.closeCoalescing(coalesceKey));
    }

    public record(command: UndoCommand, coalesceKey?: string): void {
        if (!this.recording) return;
        this.undo.push(command, coalesceKey);
    }

    public async createEmpty(parent: Entity | null): Promise<void> {
        await this.run(async () => {
            const created = await this.request(parent === null ? {op: "createEntity", name: DEFAULT_ENTITY_NAME} : {op: "createEntity", name: DEFAULT_ENTITY_NAME, parent});
            await this.recordCreation(parent === null ? "Create Empty" : "Create Empty Child", [created.entity]);
            this.select([created.entity]);
        });
    }

    public templateProblem(template: EntityTemplate): string | undefined {
        return entityTemplateProblem(template, new Set(this.schemas.keys()));
    }

    public async createFromTemplate(template: EntityTemplate): Promise<void> {
        await this.run(async () => {
            const context = {knownTypeNames: new Set(this.schemas.keys()), perspective: hasPerspectiveCamera(this.entities)};
            const created = await this.request(entityTemplateRequest(template, context));
            await this.recordCreation(`Create ${ENTITY_TEMPLATE_NAMES[template]}`, [created.entity]);
            this.select([created.entity]);
        });
    }

    public async destroy(entities: readonly Entity[]): Promise<void> {
        if (entities.length === 0) return;
        await this.run(async () => {
            const links = await this.freshLinks();
            const roots = topmostEntities(entities, parentLookupOf(links));
            const subtrees = this.recording ? await this.captureSubtrees(roots, links) : [];
            const destroyed = new Set<Entity>();
            for (const root of roots) for (const entity of (await this.request({op: "destroyEntity", entity: root})).destroyed) destroyed.add(entity);
            if (subtrees.length > 0) {
                for (const subtree of subtrees) for (const ref of subtree.entities) this.refs.markDead(ref);
                this.record(new ExistenceCommand(roots.length === 1 ? "Delete" : `Delete ${roots.length} entities`, subtrees, false));
            }
            this.select(this.selection.filter(entity => !destroyed.has(entity)));
        });
    }

    public async duplicate(entities: readonly Entity[]): Promise<void> {
        if (entities.length === 0) return;
        await this.run(async () => {
            const {roots} = await this.request({op: "duplicateEntities", entities});
            await this.recordCreation("Duplicate", roots);
            this.select(roots);
        });
    }

    public async copy(entities: readonly Entity[]): Promise<boolean> {
        if (entities.length === 0) return false;
        const copied = await this.run(async () => {
            const roots = topmostEntities(entities, parentLookupOf(this.links()));
            this.entityClipboard = (await this.request({op: "serializeEntities", entities: roots})).documentText;
            this.notice("info", `Copied ${roots.length === 1 ? "1 entity" : `${roots.length} entities`}`);
            return true;
        });
        return copied === true;
    }

    public async cut(entities: readonly Entity[]): Promise<void> {
        if (await this.copy(entities)) await this.destroy(entities);
    }

    public async paste(): Promise<void> {
        const documentText = this.entityClipboard;
        if (documentText === undefined) return;
        await this.run(async () => {
            const anchor = this.primary === undefined ? undefined : this.summaries.get(this.primary);
            const parent = anchor?.parent ?? null;
            const request: InstantiateEntitiesRequest = anchor === undefined
                ? {op: "instantiateEntities", documentText}
                : {op: "instantiateEntities", documentText, parent, siblingIndex: anchor.siblingIndex + 1};
            const {roots} = await this.request(request);
            await this.recordCreation("Paste", roots);
            this.select(roots);
        });
    }

    public async rename(entity: Entity, name: string | null): Promise<void> {
        await this.run(async () => {
            const before = (await this.request({op: "getEntity", entity})).name;
            if (before === name) return;
            await this.request({op: "renameEntity", entity, name});
            this.record(new RenameCommand("Rename", this.refs.refOf(entity), before, name));
        });
    }

    public async setEnabled(entities: readonly Entity[], enabled: boolean): Promise<void> {
        await this.run(async () => {
            const commands: UndoCommand[] = [];
            for (const entity of entities) {
                const before = this.summaries.get(entity)?.enabled ?? !enabled;
                await this.request({op: "setEnabled", entity, enabled});
                if (before !== enabled) commands.push(new EnabledCommand(enabled ? "Enable" : "Disable", this.refs.refOf(entity), before, enabled));
            }
            if (commands.length > 0) this.record(commands.length === 1 ? commands[0] : new CompositeCommand(commands[0].label, commands));
        });
    }

    public async reparent(entities: readonly Entity[], target: DropTarget): Promise<void> {
        await this.run(async () => {
            const links = await this.freshLinks();
            const parentOf = parentLookupOf(links);
            const order = new Map(links.map((link, index) => [link.entity, index]));
            const dragged = topmostEntities(entities, parentOf).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
            const plan = planMoves(siblingListsOf(links), dragged, target);
            for (const move of plan.moves) await this.request({op: "setParent", entity: move.entity, parent: move.parent, siblingIndex: move.siblingIndex});
            if (plan.moves.length > 0) this.record(SiblingOrderCommand.record(this.refs, dragged.length === 1 ? "Reparent" : `Reparent ${dragged.length} entities`, plan));
        });
    }

    public setFields(changes: readonly FieldChange[], label: string, coalesceKey?: string): Promise<SetFieldsResult | undefined> {
        return this.run(async () => {
            const result = await this.applyFieldChanges(changes);
            const recordable = changes.filter(change => !isInlineAssetSummary(change.before as EditorFieldValue));
            if (recordable.length > 0) this.record(FieldsCommand.record(this.refs, label, recordable), coalesceKey);
            return result;
        });
    }

    public async addComponent(entities: readonly Entity[], typeName: string, values: SceneJsonObject = NO_VALUES, coalesceKey?: string): Promise<void> {
        await this.run(async () => {
            const commands: UndoCommand[] = [];
            for (const entity of entities) {
                const details = await this.request({op: "getEntity", entity});
                if (details.components.some(component => component.typeName === typeName)) continue;
                const added = await this.request({op: "addComponent", entity, typeName, values});
                const component = added.components.find(candidate => candidate.typeName === typeName);
                commands.push(new ComponentPresenceCommand(`Add ${typeName}`, this.refs.refOf(entity), typeName, this.storedComponentValues(component), true));
            }
            if (commands.length > 0) this.record(commands.length === 1 ? commands[0] : new CompositeCommand(commands[0].label, commands), coalesceKey);
        });
    }

    public async removeComponent(entities: readonly Entity[], typeName: string): Promise<void> {
        await this.run(async () => {
            const commands: UndoCommand[] = [];
            for (const entity of entities) {
                const details = await this.request({op: "getEntity", entity});
                const component = details.components.find(candidate => candidate.typeName === typeName);
                if (component === undefined) continue;
                await this.request({op: "removeComponent", entity, typeName});
                commands.push(new ComponentPresenceCommand(`Remove ${typeName}`, this.refs.refOf(entity), typeName, this.storedComponentValues(component), false));
            }
            if (commands.length > 0) this.record(commands.length === 1 ? commands[0] : new CompositeCommand(commands[0].label, commands));
        });
    }

    public async resetComponent(entities: readonly Entity[], typeName: string): Promise<void> {
        await this.run(async () => {
            const commands: UndoCommand[] = [];
            for (const entity of entities) {
                const details = await this.request({op: "getEntity", entity});
                const component = details.components.find(candidate => candidate.typeName === typeName);
                if (component === undefined) continue;
                await this.request({op: "removeComponent", entity, typeName});
                const added = await this.request({op: "addComponent", entity, typeName, values: NO_VALUES});
                const reset = added.components.find(candidate => candidate.typeName === typeName);
                const ref = this.refs.refOf(entity);
                commands.push(new ComponentPresenceCommand(`Reset ${typeName}`, ref, typeName, this.storedComponentValues(component), false));
                commands.push(new ComponentPresenceCommand(`Reset ${typeName}`, ref, typeName, this.storedComponentValues(reset), true));
            }
            if (commands.length > 0) this.record(new CompositeCommand(`Reset ${typeName}`, commands));
        });
    }

    public copyComponentValues(component: EditorComponentDetails): void {
        const values: SceneJsonObject = {};
        for (const [key, value] of Object.entries(component.fields)) {
            const sendable = sendableValue(value);
            if (sendable !== undefined) values[key] = sendable;
        }
        this.componentClipboard = {typeName: component.typeName, values};
        this.notice("info", `Copied the values of ${component.typeName}`);
    }

    public async pasteComponentValues(entities: readonly Entity[], typeName: string): Promise<void> {
        const clipboard = this.componentClipboard;
        if (clipboard === undefined || clipboard.typeName !== typeName) return;
        const changes: FieldChange[] = [];
        const shapes = this.entityValueShapes(typeName);
        for (const entity of entities) {
            const component = this.detailsOf(entity)?.components.find(candidate => candidate.typeName === typeName);
            if (component === undefined) continue;
            for (const [key, after] of Object.entries(clipboard.values)) {
                const before = component.fields[key];
                if (before === undefined) continue;
                changes.push({entity, typeName, key, before: before as SceneJsonValue, after, entityShape: shapes.get(key) ?? HOLDS_NO_ENTITIES});
            }
        }
        if (changes.length > 0) await this.setFields(changes, `Paste ${typeName} values`);
    }

    public async instantiateAsset(path: string, placement: AssetPlacement): Promise<void> {
        const kind = projectFileKind(path);
        await this.run(async () => {
            const links = await this.freshLinks();
            const parent = placement.target.parent;
            const before = placement.target.before;
            const siblingIndex = before === null ? undefined : siblingIndexIn(siblingListsOf(links), parent, before);
            let root: Entity;
            if (kind === "prefab") {
                const documentText = await this.currentSession.files.readText(path);
                const request: InstantiateEntitiesRequest = siblingIndex === undefined
                    ? {op: "instantiateEntities", documentText, parent, prefabSourcePath: path}
                    : {op: "instantiateEntities", documentText, parent, siblingIndex, prefabSourcePath: path};
                const created = await this.request(request);
                root = created.roots[0];
            } else if (kind === "mesh" || isImageKind(kind)) {
                const created = await this.request(parent === null ? {op: "createEntity", name: stemOf(path)} : {op: "createEntity", name: stemOf(path), parent});
                root = created.entity;
                if (kind === "mesh") await this.request({op: "addComponent", entity: root, typeName: RENDER_MESH_TYPE_NAME, values: {[RENDER_MESH_KEY]: {path}}});
                else await this.request({op: "addComponent", entity: root, typeName: SPRITE_TYPE_NAME, values: {[SPRITE_KEY]: {path}}});
                if (siblingIndex !== undefined) await this.request({op: "setParent", entity: root, parent, siblingIndex});
            } else {
                throw new Error(`${path} is not a mesh, image or prefab, so it cannot become an entity`);
            }
            if (placement.position !== undefined) await this.placeAt(root, placement.position);
            await this.recordCreation(`Create ${stemOf(path)}`, [root]);
            this.select([root]);
        });
    }

    public async createPrefab(entity: Entity, folder: string): Promise<void> {
        if (!this.recording) {
            this.notice("warn", "Prefabs can only be created while editing; stop the game first");
            return;
        }
        await this.run(async () => {
            const files = this.currentSession.files;
            const serialized = await this.request({op: "serializeEntities", entities: [entity]});
            const document = withoutSceneMembership(withoutPrefabInstances(parseSceneDocument(serialized.documentText)));
            if (documentRootCount(document) !== 1) throw new Error("A prefab needs exactly one root entity");
            const documentText = sceneDocumentText(document);
            const summary = this.summaries.get(entity);
            const stem = safeFileStem(summary === undefined ? DEFAULT_ENTITY_NAME : entitySummaryLabel(summary));
            const path = uniqueChildPath(allProjectPaths(await files.list()), folder, stem, PREFAB_EXTENSION);
            await files.write(path, documentText);
            const links = await this.freshLinks();
            const parent = links.find(link => link.entity === entity)?.parent ?? null;
            const [previous] = await this.captureSubtrees([entity], links);
            await this.request({op: "destroyEntity", entity});
            for (const ref of previous.entities) this.refs.markDead(ref);
            const created = await this.request(previous.scene === undefined
                ? {op: "instantiateEntities", documentText, parent, siblingIndex: previous.siblingIndex, prefabSourcePath: path}
                : {op: "instantiateEntities", documentText, parent, siblingIndex: previous.siblingIndex, prefabSourcePath: path, scene: previous.scene});
            const root = created.roots[0];
            const [instance] = await this.captureSubtrees([root], await this.freshLinks());
            this.record(new CompositeCommand("Create Prefab", [new ExistenceCommand("Create Prefab", [previous], false), new ExistenceCommand("Create Prefab", [instance], true)]));
            this.select([root]);
            this.reveal(path);
            this.notice("info", `Created prefab ${path}`);
        });
    }

    public async extractInlineImage(entity: Entity, typeName: string, key: string): Promise<string | undefined> {
        const current = await this.run(() => this.request({op: "getField", entity, typeName, key}));
        if (current === undefined) return undefined;
        const format = imageFileFormatOf(current.value);
        if (format === undefined) {
            this.notice("warn", `${typeName}.${key} does not hold an inline image`);
            return undefined;
        }
        const summary = this.summaries.get(entity);
        const existing = allProjectPaths(await this.files.list());
        const chosen = await askForText(this.document, {
            title: `Extract ${typeName}.${key} to a ${format.title} file`,
            label: "File path in the project",
            initialValue: extractedImagePath(existing, safeFileStem(summary === undefined ? DEFAULT_ENTITY_NAME : entitySummaryLabel(summary)), format),
            confirmText: "Extract",
            validate: value => extractedImagePathProblem(value, existing, format),
        });
        if (chosen === undefined) return undefined;
        const path = normalizeProjectPath(chosen.trim());
        return this.run(async () => {
            if (!this.recording) throw new Error("Images can only be extracted while editing; stop the game first");
            const {value} = await this.request({op: "getField", entity, typeName, key});
            const extraction = imageExtraction(entity, typeName, key, value, path, format);
            const problem = extractedImagePathProblem(path, allProjectPaths(await this.files.list()), format);
            if (problem !== undefined) throw new Error(problem);
            await this.files.write(path, extraction.contents);
            try {
                await this.applyFieldChanges([extraction.change]);
            } catch (error) {
                await this.files.remove(path);
                throw error;
            }
            this.record(imageExtractionCommand(this.refs, `Extract ${typeName}.${key}`, extraction));
            this.reveal(path);
            this.notice("info", `Extracted ${typeName}.${key} to ${path}`);
            return path;
        });
    }

    public async inlinePatternFile(entity: Entity, typeName: string, key: string): Promise<void> {
        await this.run(async () => {
            if (!this.recording) throw new Error("Pattern files can only be inlined while editing; stop the game first");
            const {value} = await this.request({op: "getField", entity, typeName, key});
            const path = patternFilePathOf(value);
            if (path === undefined) throw new Error(`${typeName}.${key} does not name a sprite pattern file`);
            const change = patternInlining(entity, typeName, key, path, await this.currentSession.files.readText(path));
            await this.applyFieldChanges([change]);
            this.record(FieldsCommand.record(this.refs, `Inline ${typeName}.${key}`, [change]));
            this.notice("info", `Inlined ${path} into ${typeName}.${key}`);
        });
    }

    public async applyPrefab(root: Entity): Promise<void> {
        if (!this.recording) {
            this.notice("warn", "Overrides can only be applied while editing; stop the game first");
            return;
        }
        await this.run(async () => {
            const {sourcePath} = await this.request({op: "getPrefabOverrides", entity: root});
            const {documentText} = await this.request({op: "applyPrefabInstance", entity: root});
            await this.currentSession.files.write(sourcePath, documentText);
            const {updated} = await this.request({op: "updatePrefabInstances", sourcePath, documentText});
            this.scenes.prefabChanged(sourcePath);
            this.notice("info", `Applied overrides to ${sourcePath} (${updated.length === 1 ? "1 instance" : `${updated.length} instances`} updated)`);
        });
    }

    public async revertPrefab(root: Entity): Promise<void> {
        await this.run(async () => {
            const before = this.recording ? await this.captureSubtrees([root], await this.freshLinks()) : [];
            await this.request({op: "revertPrefabInstance", entity: root});
            if (before.length === 0) return;
            const after = await this.captureSubtrees([root], await this.freshLinks());
            this.record(new CompositeCommand("Revert Prefab", [new ExistenceCommand("Revert Prefab", before, false), new ExistenceCommand("Revert Prefab", after, true)]));
        });
    }

    public async updateInstancesOf(path: string): Promise<void> {
        if (!this.entities.some(summary => summary.prefabSourcePath === path)) return;
        await this.run(async () => {
            const documentText = await this.currentSession.files.readText(path);
            await this.request({op: "updatePrefabInstances", sourcePath: path, documentText});
        });
    }

    public entityValueShapes(typeName: string): Map<string, EntityValueShape> {
        const schema = this.schemas.get(typeName);
        return new Map((schema?.fields ?? []).map(field => [field.key, entityValueShapeOf(field)]));
    }

    private createHistory(): TabHistory {
        const undo = new UndoStack(this);
        undo.onChange(() => this.emit("state"));
        return {undo, refs: new EntityRefs()};
    }

    private async placeAt(entity: Entity, position: Vector3): Promise<void> {
        const details = await this.request({op: "getEntity", entity});
        const local = details.components.find(component => component.typeName === LOCAL_POSITION_TYPE_NAME)?.fields[LOCAL_POSITION_KEY];
        if (local === undefined || samePosition(local as SceneJsonValue, position)) return;
        await this.request({op: "setFields", edits: [{entity, typeName: LOCAL_POSITION_TYPE_NAME, key: LOCAL_POSITION_KEY, value: [...position]}]});
    }

    private async applyFieldChanges(changes: readonly FieldChange[]): Promise<SetFieldsResult> {
        const batched = changes.filter(change => change.typeName !== "Parent");
        const values: EditorFieldValue[] = [];
        if (batched.length > 0) {
            const result = await this.request({op: "setFields", edits: batched.map(change => ({entity: change.entity, typeName: change.typeName, key: change.key, value: change.after}))});
            values.push(...result.values);
        }
        for (const change of changes) {
            if (change.typeName !== "Parent") continue;
            values.push((await this.request({op: "setField", entity: change.entity, typeName: change.typeName, key: change.key, value: change.after})).value);
        }
        return {values};
    }

    private storedComponentValues(component: EditorComponentDetails | undefined): StoredValues {
        const values: Record<string, SceneJsonValue> = {};
        if (component !== undefined && component.inspectable) {
            for (const [key, value] of Object.entries(component.fields)) {
                const sendable = sendableValue(value);
                if (sendable !== undefined) values[key] = sendable;
            }
        }
        return storedValuesOf(this.refs, values, component === undefined ? new Map() : this.entityValueShapes(component.typeName));
    }

    private async freshLinks(): Promise<HierarchyLink[]> {
        this.showListing(await this.request({op: "listEntities"}));
        return this.links();
    }

    private async captureSubtrees(roots: readonly Entity[], links: readonly HierarchyLink[]): Promise<RecordedSubtree[]> {
        const lists = siblingListsOf(links);
        const linkOf = new Map(links.map(link => [link.entity, link]));
        const subtrees: RecordedSubtree[] = [];
        for (const root of roots) {
            const {documentText} = await this.request({op: "serializeEntities", entities: [root]});
            const parent = linkOf.get(root)?.parent ?? null;
            const recordedCount = parseSceneDocument(documentText).entities.length;
            const inOrder = subtreeInListOrder(links, root);
            const sceneId = this.summaries.get(root)?.sceneId;
            subtrees.push(recordSubtree(this.refs, {
                root,
                entitiesInCreationOrder: inOrder.length === recordedCount ? inOrder : [root],
                documentText,
                parent,
                siblingIndex: siblingIndexIn(lists, parent, root),
                scene: parent === null && sceneId !== undefined ? this.scenes.sceneRefFor(sceneId) : undefined,
            }));
        }
        return subtrees;
    }

    private async recordCreation(label: string, roots: readonly Entity[]): Promise<void> {
        if (!this.recording || roots.length === 0) return;
        const subtrees = await this.captureSubtrees(roots, await this.freshLinks());
        this.record(new ExistenceCommand(label, subtrees, true));
    }

    private showListing(listing: ListEntitiesResult): void {
        this.scenes.acceptListing(listing);
        this.entities = listing.entities;
        this.summaries = new Map(listing.entities.map(summary => [summary.entity, summary]));
        this.emit("entities");
    }

    private requestUnknownSchemas(details: readonly EditorEntityDetails[]): void {
        if (this.schemasRequested) return;
        const unknown = details.some(entity => entity.components.some(component => !this.schemas.has(component.typeName)));
        if (!unknown) return;
        this.schemasRequested = true;
        void this.loadSchemas().finally(() => this.schemasRequested = false);
    }

    private subscribeEvents(): void {
        this.unsubscribeEvents = this.currentSession.events.onEvent(event => this.receive(event));
    }

    private receive(event: EditorEvent): void {
        switch (event.kind) {
            case "console":
                this.log(event.level, event.text, event.timeMs, event.stack);
                return;
            case "worldStopped":
                this.worldStoppedError = event.error;
                this.notice("error", `World stopped: ${event.error}`, event.stack);
                this.emit("state");
                return;
            case "modeChanged":
                this.applyServiceState(event);
                return;
            case "gameCameraChanged":
                this.gameCameraMissing = !event.present;
                this.emit("gameCamera");
                return;
        }
    }

    private sessionClosed(): void {
        if (this.closed) return;
        this.closed = true;
        this.cancelEntityPick();
        this.refresh.stop();
        this.notice("warn", "The editor session ended");
        this.emit("state");
    }
}
