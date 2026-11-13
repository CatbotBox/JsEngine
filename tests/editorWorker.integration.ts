import {existsSync} from "fs";
import {join, resolve} from "path";
import {connectWorldWorker} from "../src/hosts/web";
import type {PixelSurfaceSize, PixelWorldDisplay, WorldWorker, WorldWorkerPage} from "../src/hosts/web";
import type {PixelFrame, PixelPresenterSize} from "../src/backends/pixels";
import {Key, NO_MODIFIERS} from "../src/engine/input";
import type {Entity} from "../src/engine/core";
import type {SceneJsonValue} from "../src/engine/scene";
import {EditorClient} from "../src/editor/page/editorClient";
import type {EditorChannel} from "../src/editor/page/editorClient";
import type {EditorEntityDetails, EditorEntitySummary, EditorRequest, EditorResultOf} from "../src/editor/editorProtocol";

const ROOT = resolve(__dirname, "..");
const SHIM = join(ROOT, "tests", "worldWorkerShim.ts");
const DEFAULT_DIST = "dist/web-prod";
const DIST_ARG = process.argv.indexOf("--dist");
const DIST = DIST_ARG < 0 ? undefined : resolve(process.argv[DIST_ARG + 1] ?? DEFAULT_DIST);
const SURFACE: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 10;
const FRAME_ARRIVAL_WINDOW_MS = 300;
const EDIT_FRAMES_AFTER_KEY = 10;
const PLAYER_NAME = "cross1";
const CAMERA_NAME = "cameraEntity";
const PLAYER_EDITED_XYZ = [2, 1, 0];
const PLAYER_MOVED_X = 3;
const CAMERA_EDITED_XYZ = [0, 1, -12];
const CAMERA_PAUSED_XYZ = [5, 5, 5];
const X_COMPONENT = 0;

const WORKER_SOURCES: Readonly<Record<string, string>> = {
    "editor2d": join(ROOT, "demo", "2d", "launch", "editor.worker.ts"),
    "editor3d": join(ROOT, "demo", "3d", "launch", "editor.worker.ts"),
};

function workerEntry(name: string): string {
    return DIST === undefined ? WORKER_SOURCES[name] : join(DIST, `${name}.worker.js`);
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
        this.latest = frame;
        setTimeout(onPresented, 0);
    }

    public showStatus(text: string): void {
        this.statuses.push(text);
    }

    public showError(text: string): void {
        this.errors.push(text);
    }
}

class EditorPage {
    public readonly display = new PixelFrameRecorder();
    public readonly workerErrors: string[] = [];
    public readonly client: EditorClient;
    private readonly worker: Worker;
    private readonly connection: WorldWorkerPage;

    public constructor(entry: string, name: string) {
        this.worker = new Worker(entry, {
            type: "module",
            preload: [SHIM],
            env: {
                ...process.env,
                JSENGINE_VERIFY_ISOLATED: "0",
                ...(DIST === undefined ? {} : {JSENGINE_VERIFY_DIST: DIST}),
            },
        } as WorkerOptions);
        this.worker.addEventListener("error", event => this.workerErrors.push(event.message));
        this.connection = connectWorldWorker(this.display, this.worker as unknown as WorldWorker, {name});
        this.client = new EditorClient(this.worker as unknown as EditorChannel, {timeoutMs: TIMEOUT_MS});
    }

    public ask<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        return this.client.request(request);
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
        this.worker.terminate();
    }
}

async function verifyStartsInEditMode(page: EditorPage, label: string): Promise<void> {
    expect(await waitUntil(() => page.display.frames > 0), `${label}: frames arrive in edit mode`);
    const state = await page.ask({op: "setMode", mode: "edit"});
    expect(state.mode === "edit" && state.gameplayTicks === 0, `${label}: the world starts in edit mode with no gameplay ticks (${JSON.stringify(state)})`);
    const arrived = await page.framesKeepArriving();
    expect(arrived > 0, `${label}: edit mode keeps presenting frames (${arrived} in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
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
    const loaded = await page.ask({op: "loadScene", sceneText: saved.sceneText});
    const after = (await page.ask({op: "listEntities"})).entities;
    expect(loaded.entityCount === before.length && after.length === before.length,
        `${label}: saveScene -> loadScene keeps the entity count (${before.length} -> ${loaded.entityCount} loaded, ${after.length} listed)`);
    expect(after.every(entity => !before.some(old => old.entity === entity.entity)), `${label}: loadScene replaced every entity`);
    const reloaded = after.find(entity => entity.name === checkedName);
    const reloadedXyz = reloaded === undefined ? undefined : await page.fieldOf(reloaded.entity, "LocalPosition", "xyz");
    expect(checkedXyz !== undefined && sameJson(reloadedXyz, checkedXyz), `${label}: ${checkedName} kept its position through save and load (${JSON.stringify(reloadedXyz)})`);
    const resaved = await page.ask({op: "saveScene"});
    expect(resaved.sceneText === saved.sceneText, `${label}: saving the loaded scene gives the same scene text`);
    const arrived = await page.framesKeepArriving();
    expect(arrived > 0, `${label}: frames still arrive after loading (${arrived} in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
}

async function verify2d(): Promise<void> {
    const label = "2D editor";
    const page = new EditorPage(workerEntry("editor2d"), "the 2D editor");
    try {
        await verifyStartsInEditMode(page, label);
        await verifySchemas(page, label, ["Sprite", "TextSprite", "PixelRenderSettings", "SpritePixelPassSettings", "CellRenderSettings"]);

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

        await verifySaveLoad(page, label, PLAYER_NAME);
        page.expectNoErrors(label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        page.dispose();
    }
}

async function verify3d(): Promise<void> {
    const label = "3D editor";
    const page = new EditorPage(workerEntry("editor3d"), "the 3D editor");
    try {
        await verifyStartsInEditMode(page, label);
        await verifySchemas(page, label, ["RenderMesh", "DirectionalLight", "MeshPixelPassSettings"]);

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

        await verifySaveLoad(page, label, CAMERA_NAME);
        const reloadedMeshes = (await page.ask({op: "listEntities"})).entities.filter(entity => entity.componentTypeNames.includes("RenderMesh"));
        const meshPath = reloadedMeshes.length === 0 ? undefined : await page.fieldOf(reloadedMeshes[0].entity, "RenderMesh", "mesh");
        expect(reloadedMeshes.length === meshes.length && typeof (meshPath as {path?: unknown} | undefined)?.path === "string",
            `${label}: the loaded scene has its meshes back by path (${JSON.stringify(meshPath)})`);
        page.expectNoErrors(label);
    } catch (error) {
        expect(false, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        page.dispose();
    }
}

async function main(): Promise<void> {
    if (typeof (globalThis as {Worker?: unknown}).Worker !== "function") {
        log("editor worker check: skipped, this runtime has no Web Worker global");
        return;
    }
    if (DIST !== undefined) {
        const missing = Object.keys(WORKER_SOURCES).map(workerEntry).filter(entry => !existsSync(entry));
        if (missing.length > 0) {
            log(`editor worker check: skipped, ${DIST} has no ${missing.join(", ")} (build it with --with-editor)`);
            return;
        }
        log(`running the built editor workers in ${DIST}`);
    }

    await verify2d();
    await verify3d();

    if (failures > 0) {
        console.error(`${failures} editor worker failures`);
        process.exit(1);
    }
    log("editor worker OK");
    process.exit(0);
}

void main();
