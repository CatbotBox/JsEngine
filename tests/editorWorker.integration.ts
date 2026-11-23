import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join, resolve} from "path";
import {connectWorldWorker} from "../src/hosts/web";
import type {CellArea, CellSurfaceSize, CellWorldDisplay, PixelSurfaceSize, PixelWorldDisplay, WorldWorker, WorldWorkerPage} from "../src/hosts/web";
import type {CellFrame} from "../src/backends/cells";
import {copyPixelFrame} from "../src/backends/pixels";
import type {PixelFrame, PixelPresenterSize} from "../src/backends/pixels";
import {Key, NO_MODIFIERS} from "../src/engine/input";
import type {Entity} from "../src/engine/core";
import type {SceneJsonValue} from "../src/engine/scene";
import {EditorClient} from "../src/editor/page/editorClient";
import type {EditorChannel} from "../src/editor/page/editorClient";
import {isEditorEventMessage} from "../src/editor/editorProtocol";
import type {
    EditorEntityDetails,
    EditorEntitySummary,
    EditorEvent,
    EditorRequest,
    EditorResultOf,
    EditorView,
    ExportSnapshotResult,
    ImportSnapshotRequest,
} from "../src/editor/editorProtocol";
import {FIRST_SCENE_ENTITY_ID, parseSceneDocument, SCENE_INSTANCE_COMPONENT_NAME} from "../src/engine/scene";
import type {SceneEntityRecord} from "../src/engine/scene";
import {createProjectServer} from "../src/hosts/desktop";
import type {ProjectServer} from "../src/hosts/desktop";
import {HttpProjectFileSystem} from "../src/editor/project/httpProjectFileSystem";
import type {HttpRequestInit, ProjectEventSource} from "../src/editor/project/httpProjectFileSystem";
import {serveProjectFiles} from "../src/editor/project/projectFileServing";
import type {ProjectFileServing, ProjectFilesPort} from "../src/editor/project/projectFileServing";
import {sameGameTarget} from "../src/editor/project/editorSettings";
import type {GameTarget} from "../src/editor/project/editorSettings";
import {isBuildSuccess, projectApiUrl} from "../src/editor/project/projectServerApi";
import type {BuildProjectResult, OpenProjectResult} from "../src/editor/project/projectServerApi";
import {entityRemapOf} from "../src/editor/launch/projectRunner";
import {terminalInputMessage} from "../src/editor/launch/terminalInputChannel";
import {NO_CELL_AREA, PixelEditorViewport} from "../src/editor/launch/editorViewport";
import type {EditorViewport, SharedPixelDisplay} from "../src/editor/launch/editorViewport";
import {ProjectWorkerSession} from "../src/editor/launch/projectWorkerSession";
import type {SessionVisibility} from "../src/editor/launch/projectWorkerSession";
import {STARTER_SCENE_FILE} from "../src/editor/project/projectTemplate";
import type {RenderBackendKind} from "../src/engine/rendering/renderBackend";

const ROOT = resolve(__dirname, "..");
const DIST_FLAG = "--dist";
const SERVER_ORIGIN = "http://localhost";
const JSON_HEADERS: Readonly<Record<string, string>> = {"Content-Type": "application/json"};
const NO_SERVER_EVENTS: ProjectEventSource = {on: () => () => undefined};
const SURFACE: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 10;
const FRAME_ARRIVAL_WINDOW_MS = 300;
const SAVED_SCENE_PATH = "scenes/saved.scene.json";
const EDIT_FRAMES_AFTER_KEY = 10;
const PLAYER_NAME = "cross1";
const CAMERA_NAME = "cameraEntity";
const SETTINGS_NAME = "settings";
const PLAYER_EDITED_XYZ = [2, 1, 0];
const PLAYER_MOVED_X = 3;
const CAMERA_EDITED_XYZ = [0, 1, -12];
const CAMERA_PAUSED_XYZ = [5, 5, 5];
const X_COMPONENT = 0;
const MOVED_PLAYER_XYZ = [4, 2, 0];
const PREFAB_PATH = "prefabs/cross.prefab.json";
const ADDED_SCENE_PATH = "scenes/added.scene.json";
const ADDED_ROOT_NAME = "addedRoot";
const MADE_IN_ADDED_NAME = "madeInAddedScene";
const DEMO_2D_PREFAB_PATH = "prefabs/pixel.prefab.json";
const PREFAB_TAB_ROOT_NAME = "pixel";
const PREFAB_TAB_EDITED_XYZ = [1, 2, 0];
const NO_SCENE = 0;
const ADDED_SCENE_TEXT = JSON.stringify({
    format: "jsengine-scene",
    version: 1,
    entities: [{id: 1, name: ADDED_ROOT_NAME, enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}}}],
});
const OVERRIDDEN_TINT = "#123456";
const UPDATED_OPACITY = 0.5;
const HALF = 0.5;
const AXES = 3;
const BOUNDS_SETTLE_FRAMES = 3;

const SWARM_STATE_RESOURCE = "SwarmState";
const SWARM_TUNING_RESOURCE = "SwarmTuning";
const SWARM_TUNING_PATH = "assets/swarm.tuning.asset.json";
const SWARM_START_SCENE = "scenes/main.scene.json";
const SHIP_NAME = "ship";
const SWARM_TITLE_PHASE = "Title";
const SWARM_PLAYING_PHASE = "Playing";
const EDITED_PATTERN_ROWS = ["#"];
const EDITED_PATTERN_IMAGE_SUMMARY = {inline: {width: 1, height: 1}};
const DEMO_2D_TUNING_RESOURCE = "Demo2dTuning";
const DEMO_2D_TUNING_PATH = "assets/demo2d.asset.json";
const DEMO_2D_EDITED_TUNING_KEY = "pixelsPerSpawn";
const DEMO_2D_EDITED_TUNING_VALUE = 10;
const DEMO_3D_TUNING_RESOURCE = "Demo3dTuning";
const DEMO_3D_TUNING_PATH = "assets/demo3d.asset.json";
const DEMO_3D_EDITED_TUNING_KEY = "sunRotateStepRad";
const DEMO_3D_EDITED_TUNING_VALUE = 0.25;
const WEB_PIXELS: GameTarget = {target: "web", backend: "pixels"};
const TERMINAL: GameTarget = {target: "terminal", backend: "cells"};
const TERMINAL_COLUMNS = 80;
const TERMINAL_ROWS = 24;
const RIGHT_ARROW_BYTES = "\x1b[C";
const EDITOR_VIEWS: readonly EditorView[] = ["scene", "game"];
const BACKEND_INSTALLERS: Readonly<Record<RenderBackendKind, string>> = {cells: "installCellsBackend", pixels: "installPixelsBackend", gpu: "installGpuBackend"};
const UNFOLDED_FEATURE_CONSTANT = "typeof JSENGINE_HAS_";
const FIXTURE_PARENT = join(ROOT, "dist");
const CAMERA_LESS_FIXTURE_PREFIX = "editorWorker-cameraLess-";
const FIXTURE_REMOVAL_RETRIES = 5;
const CAMERA_LESS_PROJECT_NAME = "Camera-less fixture";
const CAMERA_COMPONENT = "Camera";
const MARKER_NAME = "marker";
const MARKER_XYZ = [1, 2, 3];
const VISIBLE_SESSION: SessionVisibility = {visible: true};
const HIDDEN_SESSION: SessionVisibility = {visible: false};
const NO_QUERY = "";

interface BuiltProject {
    readonly id: string;
    readonly folder: string;
    readonly bundlePath: string;
    readonly files: HttpProjectFileSystem;
}

function log(message: string) {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string) {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs: number = TIMEOUT_MS): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (!await condition()) {
        if (performance.now() > deadline) return false;
        await sleep(POLL_INTERVAL_MS);
    }
    return true;
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

class PixelFrameRecorder implements PixelWorldDisplay {
    public readonly statuses: string[] = [];
    public readonly errors: string[] = [];
    public frames = 0;
    public latest: PixelFrame | undefined;

    public surfaceSize(): PixelSurfaceSize {
        return {kind: "pixels", ...SURFACE};
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.frames++;
        this.latest = copyPixelFrame(frame);
        setTimeout(onPresented, 0);
    }

    public showStatus(text: string): void {
        this.statuses.push(text);
    }

    public showError(text: string): void {
        this.errors.push(text);
    }
}

class CellFrameRecorder implements CellWorldDisplay {
    public readonly statuses: string[] = [];
    public readonly errors: string[] = [];
    public frames = 0;

    public surfaceSize(): CellSurfaceSize {
        return {kind: "cells", columns: TERMINAL_COLUMNS, rows: TERMINAL_ROWS};
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentCells(_frame: CellFrame, onPresented: () => void): void {
        this.frames++;
        setTimeout(onPresented, 0);
    }

    public showStatus(text: string): void {
        this.statuses.push(text);
    }

    public showError(text: string): void {
        this.errors.push(text);
    }
}

class SharedPixelFrameRecorder extends PixelFrameRecorder implements SharedPixelDisplay {
    public cellArea(): CellArea {
        return NO_CELL_AREA;
    }

    public show(): void {
    }

    public dispose(): void {
    }
}

type RecordingDisplay = PixelFrameRecorder | CellFrameRecorder;

function serverFetch(server: ProjectServer) {
    return (url: string, init?: HttpRequestInit) => server.handle(new Request(new URL(url, SERVER_ORIGIN), init as RequestInit));
}

async function postJson<T>(server: ProjectServer, route: string, body: unknown): Promise<T> {
    const response = await serverFetch(server)(projectApiUrl(route), {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    const parsed = await response.json() as T & {error?: string};
    if (!response.ok) throw new Error(`${route}: ${parsed.error ?? response.status}`);
    return parsed;
}

function verifySimulatedBundle(bundlePath: string, gameTarget: GameTarget, label: string): void {
    const text = readFileSync(bundlePath, "utf8");
    const installers = Object.entries(BACKEND_INSTALLERS).filter(([, installer]) => text.includes(installer)).map(([backend]) => backend);
    expect(sameJson(installers, [gameTarget.backend]), `${label}: the ${gameTarget.target} ${gameTarget.backend} bundle carries only the ${gameTarget.backend} installer (${installers.join(", ")})`);
    expect(!text.includes(UNFOLDED_FEATURE_CONSTANT), `${label}: the ${gameTarget.target} target's feature constants are folded into the bundle`);
}

async function buildProject(server: ProjectServer, path: string, label: string, gameTarget: GameTarget = WEB_PIXELS): Promise<BuiltProject | undefined> {
    const opened = await postJson<OpenProjectResult>(server, "open", {path});
    expect(opened.validation.ok, `${label}: ${path} is a valid project (${JSON.stringify(opened.validation)})`);
    const built = await postJson<BuildProjectResult>(server, `${opened.id}/build`, {gameTarget});
    expect(isBuildSuccess(built) && sameGameTarget(built.gameTarget, gameTarget), `${label}: the project builds on demand for ${gameTarget.target} ${gameTarget.backend} (${JSON.stringify(built)})`);
    const bundlePath = server.bundlePathOf(opened.id);
    if (!isBuildSuccess(built) || bundlePath === undefined) return undefined;
    verifySimulatedBundle(bundlePath, gameTarget, label);
    const files = new HttpProjectFileSystem({projectId: opened.id, rootLabel: path, fetch: serverFetch(server), events: NO_SERVER_EVENTS});
    return {id: opened.id, folder: opened.path, bundlePath, files};
}

class EditorPage {
    public readonly workerErrors: string[] = [];
    public readonly events: EditorEvent[] = [];
    public readonly client: EditorClient;
    public readyReports = 0;
    private readonly worker: Worker;
    private readonly connection: WorldWorkerPage;
    private readonly fileServing: ProjectFileServing;

    public constructor(project: BuiltProject, name: string, public readonly display: RecordingDisplay = new PixelFrameRecorder()) {
        this.worker = new Worker(project.bundlePath, {type: "module"});
        this.worker.addEventListener("error", event => this.workerErrors.push(event.message));
        this.fileServing = serveProjectFiles(this.worker as unknown as ProjectFilesPort, project.files);
        this.connection = connectWorldWorker(this.display, this.worker as unknown as WorldWorker, {name, onReady: () => this.readyReports++});
        this.client = new EditorClient(this.worker as unknown as EditorChannel, {timeoutMs: TIMEOUT_MS});
        this.worker.addEventListener("message", event => {
            if (isEditorEventMessage(event.data)) this.events.push(event.data.event);
        });
    }

    public ask<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        return this.client.request(request);
    }

    public sendTerminalBytes(data: string): void {
        this.worker.postMessage(terminalInputMessage(data));
    }

    public press(key: Key): void {
        this.connection.input.enqueue({type: "keyDown", key, repeat: false, ...NO_MODIFIERS});
        this.connection.input.enqueue({type: "keyUp", key, ...NO_MODIFIERS});
    }

    public async framesPass(frames: number): Promise<boolean> {
        const target = this.display.frames + frames;
        return waitUntil(() => this.display.frames >= target);
    }

    public async framesKeepArriving(): Promise<number> {
        const before = this.display.frames;
        await sleep(FRAME_ARRIVAL_WINDOW_MS);
        return this.display.frames - before;
    }

    public async entityNamed(name: string): Promise<EditorEntitySummary | undefined> {
        return (await this.ask({op: "listEntities"})).entities.find(entity => entity.name === name);
    }

    public async fieldOf(entity: Entity, typeName: string, key: string): Promise<SceneJsonValue | undefined> {
        const details: EditorEntityDetails = await this.ask({op: "getEntity", entity});
        return details.components.find(component => component.typeName === typeName)?.fields[key] as SceneJsonValue | undefined;
    }

    public expectNoErrors(label: string): void {
        const all = [...this.workerErrors, ...this.display.errors];
        expect(all.length === 0, `${label}: no worker errors${all.length > 0 ? ": " + all.join(" | ") : ""}`);
    }

    public dispose(): void {
        this.client.close();
        this.fileServing.dispose();
        this.connection.close();
    }
}

async function verifyStartsInEditMode(page: EditorPage, label: string): Promise<void> {
    expect(await waitUntil(() => page.readyReports > 0), `${label}: the worker reports ready`);
    expect(await waitUntil(() => page.display.frames > 0), `${label}: frames arrive in edit mode`);
    const state = await page.ask({op: "setMode", mode: "edit"});
    expect(state.mode === "edit" && state.gameplayTicks === 0, `${label}: the world starts in edit mode with no gameplay ticks (${JSON.stringify(state)})`);
    const arrived = await page.framesKeepArriving();
    expect(arrived > 0, `${label}: edit mode keeps presenting frames (${arrived} in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
    expect(page.readyReports === 1, `${label}: ready is reported once while frames keep arriving (${page.readyReports})`);
}

function importSnapshotRequest(exported: ExportSnapshotResult): ImportSnapshotRequest {
    return {
        op: "importSnapshot",
        documentText: exported.documentText,
        editSnapshotText: exported.editSnapshotText,
        editSnapshotRecords: exported.editSnapshotRecords,
        mode: exported.mode,
        gameplayTicks: exported.gameplayTicks,
    };
}

async function verifySchemas(page: EditorPage, label: string, typeNames: readonly string[]): Promise<void> {
    const {components} = await page.ask({op: "describeSchemas"});
    const localPosition = components.find(component => component.typeName === "LocalPosition");
    expect(sameJson(localPosition?.fields, [{key: "xyz", kind: "vec3"}]), `${label}: describeSchemas includes LocalPosition with its vec3 field`);
    const missing = typeNames.filter(typeName => !components.some(component => component.typeName === typeName));
    expect(missing.length === 0, `${label}: describeSchemas includes ${typeNames.join(", ")}${missing.length > 0 ? ` (missing ${missing.join(", ")})` : ""}`);
}

async function verifySaveLoad(page: EditorPage, label: string, checkedName: string): Promise<void> {
    const before = (await page.ask({op: "listEntities"})).entities;
    const saved = await page.ask({op: "saveScene"});
    const checked = before.find(entity => entity.name === checkedName);
    const checkedXyz = checked === undefined ? undefined : await page.fieldOf(checked.entity, "LocalPosition", "xyz");
    const loaded = await page.ask({op: "loadScene", sceneText: saved.sceneText, path: SAVED_SCENE_PATH});
    const after = (await page.ask({op: "listEntities"})).entities;
    expect(loaded.entityCount === before.length && after.length === before.length,
        `${label}: saveScene -> loadScene keeps the entity count (${before.length} -> ${loaded.entityCount} loaded, ${after.length} listed)`);
    expect(after.every(entity => !before.some(old => old.entity === entity.entity)), `${label}: loadScene replaced every entity`);
    const reloaded = after.find(entity => entity.name === checkedName);
    const reloadedXyz = reloaded === undefined ? undefined : await page.fieldOf(reloaded.entity, "LocalPosition", "xyz");
    expect(checkedXyz !== undefined && sameJson(reloadedXyz, checkedXyz), `${label}: ${checkedName} kept its position through save and load (${JSON.stringify(reloadedXyz)})`);
    const resaved = await page.ask({op: "saveScene"});
    expect(resaved.sceneText === saved.sceneText, `${label}: saving the loaded scene gives the same scene text`);
    expect(!resaved.sceneText.includes(SCENE_INSTANCE_COMPONENT_NAME), `${label}: the saved scene text carries no scene membership`);
    const arrived = await page.framesKeepArriving();
    expect(arrived > 0, `${label}: frames still arrive after loading (${arrived} in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
}

function boundsCentre(bounds: {readonly min: readonly number[], readonly max: readonly number[]}): number[] {
    const centre: number[] = [];
    for (let axis = 0; axis < AXES; axis++) centre.push((bounds.min[axis] + bounds.max[axis]) * HALF);
    return centre;
}

function toScreen(matrix: readonly number[], point: readonly number[]): {x: number, y: number} {
    const [x, y, z] = point;
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    return {
        x: (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
        y: (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    };
}

async function verifyPickingNamed(page: EditorPage, label: string, name: string, view: EditorView): Promise<void> {
    const target = await page.entityNamed(name);
    if (target === undefined) expect(false, `${label}: ${name} exists to be picked`);
    else await verifyPicking(page, label, target.entity, name, view);
}

async function verifyPicking(page: EditorPage, label: string, entity: Entity, name: string, view: EditorView): Promise<void> {
    const info = await page.ask({op: "getViewInfo", view, entities: [entity]});
    const point = toScreen(info.worldToScreen, boundsCentre(info.bounds[0]));
    const picked = await page.ask({op: "pickEntities", x: point.x, y: point.y, view});
    expect(picked.entities.includes(entity),
        `${label}: picking the ${view} view at the projected centre of ${name} (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${info.projection}) finds it (${JSON.stringify(picked.entities)})`);
}

async function verifyMoving(page: EditorPage, label: string, name: string): Promise<void> {
    const target = await page.entityNamed(name);
    if (target === undefined) return;
    await page.framesPass(BOUNDS_SETTLE_FRAMES);
    const before = (await page.ask({op: "getViewInfo", view: "scene", entities: [target.entity]})).bounds[0];
    const previous = await page.fieldOf(target.entity, "LocalPosition", "xyz") as number[];
    const moved = await page.ask({op: "setFields", edits: [{entity: target.entity, typeName: "LocalPosition", key: "xyz", value: MOVED_PLAYER_XYZ}]});
    expect(sameJson(moved.values, [MOVED_PLAYER_XYZ]), `${label}: setFields moves ${name} (${JSON.stringify(moved.values)})`);
    await page.framesPass(BOUNDS_SETTLE_FRAMES);
    const after = (await page.ask({op: "getViewInfo", view: "scene", entities: [target.entity]})).bounds[0];
    const shift = after.min[X_COMPONENT] - before.min[X_COMPONENT];
    expect(shift === MOVED_PLAYER_XYZ[X_COMPONENT] - previous[X_COMPONENT], `${label}: the bounds of ${name} followed the move (x shift ${shift})`);
    await verifyPicking(page, label, target.entity, name, "scene");
}

async function verifyUndoOfDestroy(page: EditorPage, label: string, name: string): Promise<void> {
    const target = await page.entityNamed(name);
    if (target === undefined) return;
    const xyz = await page.fieldOf(target.entity, "LocalPosition", "xyz");
    const {documentText} = await page.ask({op: "serializeEntities", entities: [target.entity]});
    await page.ask({op: "destroyEntity", entity: target.entity});
    expect(await page.entityNamed(name) === undefined, `${label}: ${name} is gone after destroyEntity`);
    const restored = await page.ask({op: "instantiateEntities", documentText, parent: target.parent, siblingIndex: target.siblingIndex});
    const again = await page.entityNamed(name);
    expect(again !== undefined && again.entity === restored.roots[0] && again.parent === target.parent && again.siblingIndex === target.siblingIndex,
        `${label}: instantiateEntities restores ${name} under the same parent at sibling ${target.siblingIndex}`);
    const restoredXyz = again === undefined ? undefined : await page.fieldOf(again.entity, "LocalPosition", "xyz");
    expect(sameJson(restoredXyz, xyz), `${label}: the restored ${name} kept its position (${JSON.stringify(restoredXyz)})`);
}

async function verifyPrefabs(page: EditorPage, label: string, name: string): Promise<void> {
    const source = await page.entityNamed(name);
    if (source === undefined) return;
    const {documentText} = await page.ask({op: "serializeEntities", entities: [source.entity]});
    const created = await page.ask({op: "instantiateEntities", documentText, prefabSourcePath: PREFAB_PATH});
    const instance = created.roots[0];
    const fresh = await page.ask({op: "getPrefabOverrides", entity: instance});
    expect(fresh.sourcePath === PREFAB_PATH && fresh.overrides.length === 0, `${label}: a new prefab instance has no overrides (${JSON.stringify(fresh)})`);
    await page.ask({op: "setField", entity: instance, typeName: "Sprite", key: "tint", value: OVERRIDDEN_TINT});
    const overridden = await page.ask({op: "getPrefabOverrides", entity: instance});
    expect(sameJson(overridden.overrides, ["/Sprite.tint"]), `${label}: editing the tint of the instance is an override (${JSON.stringify(overridden.overrides)})`);
    const document = parseSceneDocument(documentText);
    document.entities[0].components.Sprite.opacity = UPDATED_OPACITY;
    const {updated} = await page.ask({op: "updatePrefabInstances", sourcePath: PREFAB_PATH, documentText: JSON.stringify(document)});
    const opacity = await page.fieldOf(instance, "Sprite", "opacity");
    const tint = await page.fieldOf(instance, "Sprite", "tint");
    expect(updated.includes(instance) && opacity === UPDATED_OPACITY && tint === OVERRIDDEN_TINT,
        `${label}: updating the prefab changes the opacity of the instance (${opacity}) and keeps its overridden tint (${tint})`);
    await page.ask({op: "destroyEntity", entity: instance});
}

function savedNames(sceneText: string): (string | null)[] {
    return parseSceneDocument(sceneText).entities.map(record => record.name);
}

async function verifyAdditiveScenes(page: EditorPage, label: string): Promise<void> {
    const before = await page.ask({op: "listEntities"});
    const opened = before.activeSceneId;
    expect(opened !== NO_SCENE && before.scenes.length === 1, `${label}: one scene is open and active before adding one (${JSON.stringify(before.scenes)}, active ${opened})`);
    const added = await page.ask({op: "loadScene", sceneText: ADDED_SCENE_TEXT, path: ADDED_SCENE_PATH, additive: true});
    const withAdded = await page.ask({op: "listEntities"});
    const addedRoot = withAdded.entities.find(entity => entity.name === ADDED_ROOT_NAME);
    expect(withAdded.entities.length === before.entities.length + 1 && withAdded.scenes.length === 2 && withAdded.activeSceneId === opened,
        `${label}: an additive load keeps the open scene active and adds its entities beside it (${before.entities.length} -> ${withAdded.entities.length})`);
    expect(addedRoot?.sceneId === added.sceneId && withAdded.entities.every(entity => entity === addedRoot || entity.sceneId === opened),
        `${label}: every listed entity reports the scene it belongs to`);

    const activated = await page.ask({op: "setActiveScene", scene: {id: added.sceneId, path: ADDED_SCENE_PATH}});
    const made = await page.ask({op: "createEntity", name: MADE_IN_ADDED_NAME});
    const afterCreate = await page.ask({op: "listEntities"});
    expect(activated.sceneId === added.sceneId && afterCreate.activeSceneId === added.sceneId
        && afterCreate.entities.find(entity => entity.entity === made.entity)?.sceneId === added.sceneId,
    `${label}: after Set Active, a new entity lands in the added scene`);
    expect(sameJson(afterCreate.editedSceneIds, [added.sceneId]), `${label}: only the added scene is marked edited (${JSON.stringify(afterCreate.editedSceneIds)})`);

    const savedAdded = await page.ask({op: "saveScene", scene: {id: added.sceneId, path: ADDED_SCENE_PATH}});
    const savedOpened = await page.ask({op: "saveScene", scene: {id: opened, path: before.scenes[0].path}});
    expect(sameJson(savedNames(savedAdded.sceneText), [ADDED_ROOT_NAME, MADE_IN_ADDED_NAME]), `${label}: saving the added scene writes only its entities (${JSON.stringify(savedNames(savedAdded.sceneText))})`);
    expect(savedNames(savedOpened.sceneText).length === before.entities.length && !savedOpened.sceneText.includes(ADDED_ROOT_NAME),
        `${label}: saving the open scene leaves the added scene's entities out`);
    expect((await page.ask({op: "listEntities"})).editedSceneIds.length === 0, `${label}: saving clears the edited marks`);

    const unloaded = await page.ask({op: "unloadScene", sceneId: added.sceneId});
    const afterUnload = await page.ask({op: "listEntities"});
    expect(unloaded.activeSceneId === opened && afterUnload.entities.length === before.entities.length && afterUnload.scenes.length === 1,
        `${label}: unloading the added scene removes exactly its entities and makes the open scene active again`);
}

async function verifyPrefabTab(page: EditorPage, project: BuiltProject, label: string): Promise<void> {
    const before = await page.ask({op: "listEntities"});
    const stash = await page.ask({op: "exportSnapshot"});
    const prefabText = await project.files.readText(DEMO_2D_PREFAB_PATH);
    const opened = await page.ask({op: "loadScene", sceneText: prefabText, path: DEMO_2D_PREFAB_PATH});
    const prefabListing = await page.ask({op: "listEntities"});
    const root = prefabListing.entities.find(entity => entity.name === PREFAB_TAB_ROOT_NAME);
    expect(root !== undefined && prefabListing.entities.every(entity => entity.sceneId === opened.sceneId) && prefabListing.activeSceneId === opened.sceneId,
        `${label}: the prefab opens on its own as the only scene (${prefabListing.entities.length} entities)`);
    if (root === undefined) return;
    await page.ask({op: "setField", entity: root.entity, typeName: "LocalPosition", key: "xyz", value: PREFAB_TAB_EDITED_XYZ});
    expect(sameJson((await page.ask({op: "listEntities"})).editedSceneIds, [opened.sceneId]), `${label}: editing the prefab marks the prefab tab's scene`);
    const savedPrefab = await page.ask({op: "saveScene", scene: {id: opened.sceneId, path: DEMO_2D_PREFAB_PATH}});
    expect(sameJson(savedNames(savedPrefab.sceneText), savedNames(prefabText)), `${label}: saving the prefab tab writes the prefab's entities only`);

    const restored = await page.ask({op: "importSnapshot", documentText: stash.documentText, mode: "edit"});
    const back = await page.ask({op: "listEntities"});
    const remap = entityRemapOf(stash.entities, restored.entities);
    expect(restored.entities.length === stash.entities.length && back.entities.length === before.entities.length && back.activeSceneId === before.activeSceneId,
        `${label}: going back from the prefab tab restores the scene, its entities and its active scene`);
    expect(before.entities.every(entity => back.entities.some(listed => listed.entity === remap.get(entity.entity) && listed.name === entity.name && listed.sceneId === entity.sceneId)),
        `${label}: every entity comes back with its name and scene, remapped by record`);
    const {updated} = await page.ask({op: "updatePrefabInstances", sourcePath: DEMO_2D_PREFAB_PATH, documentText: savedPrefab.sceneText});
    expect(Array.isArray(updated), `${label}: the restored scene takes the saved prefab (${updated.length} instances updated)`);
    expect(back.editedSceneIds.length === 0, `${label}: restoring a stashed tab starts with no edited marks`);
}

async function verifyDomainReload(project: BuiltProject, page: EditorPage, label: string, checkedName: string): Promise<void> {
    const checked = await page.entityNamed(checkedName);
    const checkedXyz = checked === undefined ? undefined : await page.fieldOf(checked.entity, "LocalPosition", "xyz");
    const exported = await page.ask({op: "exportSnapshot"});
    const reloaded = new EditorPage(project, `${label} (reloaded)`);
    try {
        expect(await waitUntil(() => reloaded.readyReports > 0), `${label}: a second worker from the same bundle reports ready`);
        const imported = await reloaded.ask(importSnapshotRequest(exported));
        const remap = entityRemapOf(exported.entities, imported.entities);
        expect(imported.entities.length === exported.entities.length, `${label}: importSnapshot recreates every exported entity (${exported.entities.length} -> ${imported.entities.length})`);
        expect(imported.report.skippedComponentTypes.length === 0, `${label}: every component type survives the domain reload (${JSON.stringify(imported.report.skippedComponentTypes)})`);
        const moved = checked === undefined ? undefined : remap.get(checked.entity);
        const movedXyz = moved === undefined ? undefined : await reloaded.fieldOf(moved, "LocalPosition", "xyz");
        expect(checkedXyz !== undefined && sameJson(movedXyz, checkedXyz), `${label}: the remapped ${checkedName} kept its position through the domain reload (${JSON.stringify(movedXyz)})`);
        expect(await waitUntil(() => reloaded.display.frames > 0), `${label}: the second worker presents frames`);
        expect(reloaded.readyReports === 1, `${label}: the second worker reported ready once (${reloaded.readyReports})`);
        reloaded.expectNoErrors(`${label} (reloaded)`);
    } finally {
        reloaded.dispose();
    }
}

async function verify2d(project: BuiltProject): Promise<void> {
    const label = "2D editor";
    const page = new EditorPage(project, "the 2D editor");
    try {
        await verifyStartsInEditMode(page, label);
        await verifySchemas(page, label, ["Sprite", "TextSprite", "PixelRenderSettings", "SpritePixelPassSettings", "CellRenderSettings", "FadeToColor", "OriginalColor", "PlayerTag"]);

        const camera = await page.entityNamed(CAMERA_NAME);
        const player = await page.entityNamed(PLAYER_NAME);
        expect(camera !== undefined, `${label}: listEntities has ${CAMERA_NAME}`);
        expect(player !== undefined && player.parent === camera?.entity, `${label}: listEntities has the player ${PLAYER_NAME}, parented to the camera`);
        if (player === undefined) return;

        const set = await page.ask({op: "setField", entity: player.entity, typeName: "LocalPosition", key: "xyz", value: PLAYER_EDITED_XYZ});
        const shown = await page.fieldOf(player.entity, "LocalPosition", "xyz");
        expect(sameJson(set.value, PLAYER_EDITED_XYZ) && sameJson(shown, PLAYER_EDITED_XYZ), `${label}: setField then getEntity shows the new position (${JSON.stringify(shown)})`);

        page.press(Key.Right);
        expect(await page.framesPass(EDIT_FRAMES_AFTER_KEY), `${label}: ${EDIT_FRAMES_AFTER_KEY} edit frames passed after pressing Right`);
        const editX = (await page.fieldOf(player.entity, "LocalPosition", "xyz") as number[])[X_COMPONENT];
        expect(editX === PLAYER_EDITED_XYZ[X_COMPONENT], `${label}: an arrow key does not move the player in edit mode (x ${editX})`);

        const playing = await page.ask({op: "setMode", mode: "play"});
        expect(playing.mode === "play", `${label}: setMode play`);
        page.press(Key.Right);
        const moved = await waitUntil(async () => (await page.fieldOf(player.entity, "LocalPosition", "xyz") as number[])[X_COMPONENT] === PLAYER_MOVED_X);
        expect(moved, `${label}: the same arrow key moves the player in play mode (x ${PLAYER_EDITED_XYZ[X_COMPONENT]} -> ${PLAYER_MOVED_X})`);

        const paused = await page.ask({op: "setMode", mode: "paused"});
        const stepped = await page.ask({op: "step"});
        expect(paused.mode === "paused" && stepped.mode === "paused" && stepped.gameplayTicks === paused.gameplayTicks + 1,
            `${label}: step runs one gameplay tick (${paused.gameplayTicks} -> ${stepped.gameplayTicks})`);

        const stopped = await page.ask({op: "setMode", mode: "edit"});
        const restored = await page.fieldOf(player.entity, "LocalPosition", "xyz");
        expect(stopped.mode === "edit" && sameJson(restored, PLAYER_EDITED_XYZ), `${label}: stop restores the snapshot position (${JSON.stringify(restored)})`);

        const parent = await page.ask({op: "createEntity", name: "editorParent"});
        const child = await page.ask({op: "createEntity", name: "editorChild", parent: parent.entity});
        const listedChild = await page.entityNamed("editorChild");
        expect(await page.entityNamed("editorParent") !== undefined && listedChild?.parent === parent.entity, `${label}: created entities are listed, the child under its parent`);
        const {destroyed} = await page.ask({op: "destroyEntity", entity: parent.entity});
        const remaining = (await page.ask({op: "listEntities"})).entities.filter(entity => entity.name === "editorParent" || entity.name === "editorChild");
        expect(destroyed.includes(child.entity) && remaining.length === 0, `${label}: destroying the parent removed its child`);

        expect(page.events.some(event => event.kind === "modeChanged" && event.mode === "play"), `${label}: the page received a modeChanged event for play`);
        await verifyPickingNamed(page, label, PLAYER_NAME, "scene");
        await verifyMoving(page, label, PLAYER_NAME);
        await verifyUndoOfDestroy(page, label, PLAYER_NAME);
        await verifyPrefabs(page, label, PLAYER_NAME);
        await verifySaveLoad(page, label, PLAYER_NAME);
        await verifyAdditiveScenes(page, label);
        await verifyPrefabTab(page, project, label);
        await verifyTuningEdit(page, label, DEMO_2D_TUNING_RESOURCE, DEMO_2D_TUNING_PATH, DEMO_2D_EDITED_TUNING_KEY, DEMO_2D_EDITED_TUNING_VALUE);
        const cross = await page.entityNamed(PLAYER_NAME);
        if (cross !== undefined) await verifySpritePatternEdit(page, label, cross.entity, PLAYER_NAME);
        await verifyDomainReload(project, page, label, PLAYER_NAME);
        page.expectNoErrors(label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        page.dispose();
    }
}

async function verify3d(project: BuiltProject): Promise<void> {
    const label = "3D editor";
    const page = new EditorPage(project, "the 3D editor");
    try {
        await verifyStartsInEditMode(page, label);
        await verifySchemas(page, label, ["RenderMesh", "DirectionalLight", "MeshPixelPassSettings", "MeshRenderSettings"]);
        const settings = await page.entityNamed(SETTINGS_NAME);
        expect(settings?.componentTypeNames.includes("MeshRenderSettings") === true, `${label}: the scene's ${SETTINGS_NAME} entity loaded its MeshRenderSettings`);

        const camera = await page.entityNamed(CAMERA_NAME);
        expect(camera !== undefined, `${label}: listEntities has ${CAMERA_NAME}`);
        const meshes = (await page.ask({op: "listEntities"})).entities.filter(entity => entity.componentTypeNames.includes("RenderMesh"));
        expect(meshes.length > 0, `${label}: the spawned model is listed with a RenderMesh`);
        if (camera === undefined) return;

        await page.ask({op: "setField", entity: camera.entity, typeName: "LocalPosition", key: "xyz", value: CAMERA_EDITED_XYZ});
        const shown = await page.fieldOf(camera.entity, "LocalPosition", "xyz");
        expect(sameJson(shown, CAMERA_EDITED_XYZ), `${label}: setField then getEntity shows the new camera position (${JSON.stringify(shown)})`);

        const paused = await page.ask({op: "setMode", mode: "paused"});
        const stepped = await page.ask({op: "step"});
        expect(stepped.gameplayTicks === paused.gameplayTicks + 1, `${label}: step runs one gameplay tick (${paused.gameplayTicks} -> ${stepped.gameplayTicks})`);
        await page.ask({op: "setField", entity: camera.entity, typeName: "LocalPosition", key: "xyz", value: CAMERA_PAUSED_XYZ});
        await page.ask({op: "setMode", mode: "edit"});
        const restored = await page.fieldOf(camera.entity, "LocalPosition", "xyz");
        expect(sameJson(restored, CAMERA_EDITED_XYZ), `${label}: stop restores the snapshot camera position (${JSON.stringify(restored)})`);

        if (meshes.length > 0) await verifyPicking(page, label, meshes[0].entity, "the spawned model", "scene");
        await verifySaveLoad(page, label, CAMERA_NAME);
        const reloadedMeshes = (await page.ask({op: "listEntities"})).entities.filter(entity => entity.componentTypeNames.includes("RenderMesh"));
        const meshPath = reloadedMeshes.length === 0 ? undefined : await page.fieldOf(reloadedMeshes[0].entity, "RenderMesh", "mesh");
        expect(reloadedMeshes.length === meshes.length && typeof (meshPath as {path?: unknown} | undefined)?.path === "string",
            `${label}: the loaded scene has its meshes back by path (${JSON.stringify(meshPath)})`);
        await verifyTuningEdit(page, label, DEMO_3D_TUNING_RESOURCE, DEMO_3D_TUNING_PATH, DEMO_3D_EDITED_TUNING_KEY, DEMO_3D_EDITED_TUNING_VALUE);
        await verifyDomainReload(project, page, label, CAMERA_NAME);
        page.expectNoErrors(label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        page.dispose();
    }
}

async function openStartScene(page: EditorPage, project: BuiltProject, label: string, path: string): Promise<void> {
    const sceneText = await project.files.readText(path);
    const loaded = await page.ask({op: "loadScene", sceneText, path});
    expect(loaded.entityCount > 0, `${label}: the start scene ${path} opens (${loaded.entityCount} entities)`);
}

async function verifySpritePatternEdit(page: EditorPage, label: string, entity: Entity, name: string): Promise<void> {
    await page.ask({op: "setField", entity, typeName: "SpritePattern", key: "rows", value: EDITED_PATTERN_ROWS});
    const rows = await page.fieldOf(entity, "SpritePattern", "rows");
    expect(sameJson(rows, EDITED_PATTERN_ROWS), `${label}: the sprite pattern rows of ${name} are editable (${JSON.stringify(rows)})`);
    expect(await page.framesPass(BOUNDS_SETTLE_FRAMES), `${label}: frames pass after editing the sprite pattern`);
    const image = await page.fieldOf(entity, "Sprite", "image");
    expect(sameJson(image, EDITED_PATTERN_IMAGE_SUMMARY), `${label}: the sprite image of ${name} is rebuilt from the edited pattern (${JSON.stringify(image)})`);
    const saved = parseSceneDocument((await page.ask({op: "saveScene"})).sceneText);
    const savedImage = saved.entities.find(record => record.name === name)?.components.Sprite?.image;
    expect(savedImage === null, `${label}: the rebuilt sprite image saves as null, its pattern is the saved form (${JSON.stringify(savedImage)})`);
}

async function verifyTuningEdit(page: EditorPage, label: string, typeName: string, path: string, key: string, value: SceneJsonValue): Promise<void> {
    const loaded = await page.ask({op: "getResource", typeName});
    expect(loaded.dataAssetPath === path, `${label}: ${typeName} is loaded from ${path} (${loaded.dataAssetPath})`);
    await page.ask({op: "setMode", mode: "paused"});
    await page.ask({op: "setResourceField", typeName, key, value});
    const edited = await page.ask({op: "getResource", typeName});
    expect(sameJson(edited.fields[key], value), `${label}: ${typeName}.${key} is editable while paused (${JSON.stringify(edited.fields[key])})`);
    const {reloaded} = await page.ask({op: "reloadDataAsset", path});
    const restored = await page.ask({op: "getResource", typeName});
    expect(reloaded && sameJson(restored.fields[key], loaded.fields[key]), `${label}: reloading ${path} restores ${typeName}.${key} from the file (${JSON.stringify(restored.fields[key])})`);
    await page.ask({op: "setMode", mode: "edit"});
}

async function swarmPhase(page: EditorPage): Promise<unknown> {
    return (await page.ask({op: "getResource", typeName: SWARM_STATE_RESOURCE})).fields.phase;
}

async function verifySwarmGate(page: EditorPage, label: string): Promise<void> {
    page.press(Key.Enter);
    expect(await page.framesPass(EDIT_FRAMES_AFTER_KEY), `${label}: ${EDIT_FRAMES_AFTER_KEY} edit frames passed after pressing Enter`);
    const editPhase = await swarmPhase(page);
    expect(editPhase === SWARM_TITLE_PHASE, `${label}: Enter does not start a game in edit mode, the generated system list is suspended (phase ${JSON.stringify(editPhase)})`);
    await page.ask({op: "setMode", mode: "play"});
    page.press(Key.Enter);
    const started = await waitUntil(async () => await swarmPhase(page) === SWARM_PLAYING_PHASE);
    expect(started, `${label}: the same Enter starts a game in play mode`);
    await page.ask({op: "setMode", mode: "edit"});
}

async function verifySwarm(project: BuiltProject): Promise<void> {
    const label = "Swarm editor";
    const page = new EditorPage(project, "the Swarm editor");
    try {
        await verifyStartsInEditMode(page, label);
        await verifySchemas(page, label, ["Ship", "Enemy", "Bullet", "Velocity", "Lifetime", "Spark", "SwarmHud", "SpritePattern", "SpritePixelPassSettings"]);
        const {resources} = await page.ask({op: "describeSchemas"});
        for (const typeName of [SWARM_STATE_RESOURCE, SWARM_TUNING_RESOURCE]) {
            expect(resources.some(resource => resource.typeName === typeName), `${label}: describeSchemas lists the ${typeName} resource`);
        }
        const tuning = await page.ask({op: "getResource", typeName: SWARM_TUNING_RESOURCE});
        expect(tuning.dataAssetPath === SWARM_TUNING_PATH, `${label}: ${SWARM_TUNING_RESOURCE} is loaded from ${SWARM_TUNING_PATH} (${tuning.dataAssetPath})`);
        await openStartScene(page, project, label, SWARM_START_SCENE);
        const ship = await page.entityNamed(SHIP_NAME);
        expect(ship !== undefined && ship.componentTypeNames.includes("Ship") && ship.componentTypeNames.includes("SpritePattern"),
            `${label}: the start scene has the ship with its Ship and SpritePattern components`);
        await verifySwarmGate(page, label);
        if (ship !== undefined) await verifySpritePatternEdit(page, label, ship.entity, SHIP_NAME);
        await verifySaveLoad(page, label, SHIP_NAME);
        await verifyDomainReload(project, page, label, SHIP_NAME);
        page.expectNoErrors(label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        page.dispose();
    }
}

async function verifyTerminalTargetSwitch(server: ProjectServer): Promise<void> {
    const label = "2D editor on the terminal target";
    const project = await buildProject(server, "demo/2d", label, TERMINAL);
    if (project === undefined) return;
    const page = new EditorPage(project, "the 2D editor simulating the terminal", new CellFrameRecorder());
    try {
        await verifyStartsInEditMode(page, label);
        const player = await page.entityNamed(PLAYER_NAME);
        expect(player !== undefined, `${label}: listEntities has the player ${PLAYER_NAME}`);
        if (player === undefined) return;
        await page.ask({op: "setField", entity: player.entity, typeName: "LocalPosition", key: "xyz", value: PLAYER_EDITED_XYZ});
        page.sendTerminalBytes(RIGHT_ARROW_BYTES);
        expect(await page.framesPass(EDIT_FRAMES_AFTER_KEY), `${label}: ${EDIT_FRAMES_AFTER_KEY} edit frames passed after the right-arrow bytes`);
        const editX = (await page.fieldOf(player.entity, "LocalPosition", "xyz") as number[])[X_COMPONENT];
        expect(editX === PLAYER_EDITED_XYZ[X_COMPONENT], `${label}: terminal bytes do not move the player in edit mode (x ${editX})`);
        await page.ask({op: "setMode", mode: "play"});
        page.sendTerminalBytes(RIGHT_ARROW_BYTES);
        const moved = await waitUntil(async () => (await page.fieldOf(player.entity, "LocalPosition", "xyz") as number[])[X_COMPONENT] === PLAYER_MOVED_X);
        expect(moved, `${label}: the right-arrow bytes reach the game through TerminalInput in play mode (x ${PLAYER_EDITED_XYZ[X_COMPONENT]} -> ${PLAYER_MOVED_X})`);
        await page.ask({op: "setMode", mode: "edit"});
        for (const view of EDITOR_VIEWS) {
            const shown = await page.ask({op: "setView", view});
            const arrived = await page.framesKeepArriving();
            expect(shown.view === view && arrived > 0, `${label}: the ${view} view draws through the one cells backend (${arrived} frames in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
            await verifyPickingNamed(page, label, PLAYER_NAME, view);
        }
        const switched = await postJson<BuildProjectResult>(server, `${project.id}/build`, {gameTarget: WEB_PIXELS});
        const switchedBundle = server.bundlePathOf(project.id);
        expect(isBuildSuccess(switched) && sameGameTarget(switched.gameTarget, WEB_PIXELS) && switchedBundle !== project.bundlePath,
            `${label}: switching to web pixels builds that target's bundle beside the terminal one (${JSON.stringify(switched)})`);
        if (!isBuildSuccess(switched) || switchedBundle === undefined) return;
        verifySimulatedBundle(switchedBundle, WEB_PIXELS, `${label} switched to web pixels`);
        await verifyDomainReload({...project, bundlePath: switchedBundle}, page, `${label} switched to web pixels`, PLAYER_NAME);
        page.expectNoErrors(label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        page.dispose();
    }
}

function removeCamerasFromStarterScene(folder: string): void {
    const path = join(folder, ...STARTER_SCENE_FILE.split("/"));
    const document = parseSceneDocument(readFileSync(path, "utf8"));
    const marker: SceneEntityRecord = {
        id: Math.max(FIRST_SCENE_ENTITY_ID, ...document.entities.map(record => record.id + 1)),
        name: MARKER_NAME,
        enabled: true,
        components: {LocalPosition: {xyz: MARKER_XYZ}},
    };
    const entities = [...document.entities.filter(record => record.components[CAMERA_COMPONENT] === undefined), marker];
    writeFileSync(path, JSON.stringify({...document, entities}));
}

function startEditorSession(project: BuiltProject, viewport: EditorViewport, visibility: SessionVisibility, name: string): Promise<ProjectWorkerSession> {
    return ProjectWorkerSession.start({workerUrl: project.bundlePath, viewport, files: project.files, name, search: NO_QUERY, visibility, onQuit: () => undefined});
}

async function sessionWithin(starting: Promise<ProjectWorkerSession>, timeoutMs: number): Promise<ProjectWorkerSession | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<undefined>(done => {
        timer = setTimeout(() => done(undefined), timeoutMs);
    });
    try {
        const session = await Promise.race([starting, timedOut]);
        if (session === undefined) void starting.then(late => late.dispose(), () => undefined);
        return session;
    } finally {
        clearTimeout(timer);
    }
}

async function markerDetails(client: EditorClient): Promise<EditorEntityDetails | undefined> {
    const marker = (await client.request({op: "listEntities"})).entities.find(entity => entity.name === MARKER_NAME);
    return marker === undefined ? undefined : await client.request({op: "getEntity", entity: marker.entity});
}

async function verifyCameraLessWorker(project: BuiltProject, label: string): Promise<void> {
    const page = new EditorPage(project, "the camera-less scene");
    try {
        expect(await waitUntil(() => page.readyReports > 0), `${label}: the worker reports ready`);
        const listed = (await page.ask({op: "listEntities"})).entities;
        expect(listed.some(entity => entity.name === MARKER_NAME) && !listed.some(entity => entity.componentTypeNames.includes(CAMERA_COMPONENT)),
            `${label}: the start scene is open with its entities and no camera (${listed.map(entity => entity.name).join(", ")})`);
        const arrived = await page.framesKeepArriving();
        expect(page.display.frames === 0, `${label}: no frame is drawn without a camera (${page.display.frames} in all, ${arrived} in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
        expect(page.readyReports === 1, `${label}: ready is reported once (${page.readyReports})`);
        page.expectNoErrors(label);
    } finally {
        page.dispose();
    }
}

async function verifyCameraLessHotReload(project: BuiltProject, label: string): Promise<void> {
    const display = new SharedPixelFrameRecorder();
    const viewport = new PixelEditorViewport(display, WEB_PIXELS);
    const opened = await sessionWithin(startEditorSession(project, viewport, VISIBLE_SESSION, label), TIMEOUT_MS);
    expect(opened !== undefined, `${label}: the editor page's worker session opens within ${TIMEOUT_MS} ms`);
    if (opened === undefined) return;
    try {
        const before = await markerDetails(opened.client);
        const exported = await opened.client.request({op: "exportSnapshot"});
        const reloaded = await sessionWithin(startEditorSession(project, viewport, HIDDEN_SESSION, `${label} (reloaded)`), TIMEOUT_MS);
        expect(reloaded !== undefined, `${label}: a hot reload's hidden worker session opens within ${TIMEOUT_MS} ms`);
        if (reloaded === undefined) return;
        try {
            const imported = await reloaded.client.request(importSnapshotRequest(exported));
            const remap = entityRemapOf(exported.entities, imported.entities);
            const after = await markerDetails(reloaded.client);
            const xyz = after?.components.find(component => component.typeName === "LocalPosition")?.fields.xyz;
            expect(before !== undefined && after?.entity === remap.get(before.entity) && sameJson(xyz, MARKER_XYZ),
                `${label}: the hot-reloaded session holds the imported scene, ${MARKER_NAME} remapped with its position (${JSON.stringify(xyz)})`);
            expect(display.frames === 0 && display.errors.length === 0,
                `${label}: both sessions opened with no frame and no error (${display.frames} frames${display.errors.length > 0 ? ": " + display.errors.join(" | ") : ""})`);
        } finally {
            reloaded.dispose();
        }
    } finally {
        opened.dispose();
    }
}

async function verifyCameraLessScene(server: ProjectServer, folder: string): Promise<void> {
    const label = "Camera-less scene";
    try {
        const created = await postJson<OpenProjectResult>(server, "create", {path: folder, name: CAMERA_LESS_PROJECT_NAME});
        expect(created.validation.ok, `${label}: a new project is created from the template (${JSON.stringify(created.validation)})`);
        removeCamerasFromStarterScene(folder);
        const project = await buildProject(server, folder, label);
        if (project === undefined) return;
        await verifyCameraLessWorker(project, label);
        await verifyCameraLessHotReload(project, label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function main(): Promise<void> {
    if (typeof (globalThis as {Worker?: unknown}).Worker !== "function") {
        log("editor worker check: skipped, this runtime has no Web Worker global");
        return;
    }
    if (process.argv.includes(DIST_FLAG)) {
        log("editor worker check: skipped, the editor builds project workers on demand, so a built site holds none to run");
        return;
    }
    if (process.versions.bun === undefined) {
        log("editor worker check: skipped, building project workers needs bun");
        return;
    }

    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const cameraLessFolder = mkdtempSync(join(FIXTURE_PARENT, CAMERA_LESS_FIXTURE_PREFIX));
    const server = createProjectServer({repoRoot: ROOT, bun: {path: process.execPath}, browse: false});
    try {
        const project2d = await buildProject(server, "demo/2d", "2D editor");
        const project3d = await buildProject(server, "demo/3d", "3D editor");
        const projectSwarm = await buildProject(server, "demo/swarm", "Swarm editor");
        if (project2d !== undefined) await verify2d(project2d);
        if (project3d !== undefined) await verify3d(project3d);
        if (projectSwarm !== undefined) await verifySwarm(projectSwarm);
        await verifyTerminalTargetSwitch(server);
        await verifyCameraLessScene(server, cameraLessFolder);
    } finally {
        server.close();
        rmSync(cameraLessFolder, {recursive: true, force: true, maxRetries: FIXTURE_REMOVAL_RETRIES});
    }

    if (failures > 0) {
        console.error(`${failures} editor worker failures`);
        process.exit(1);
    }
    log("editor worker OK");
    process.exit(0);
}

void main();
