import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {dirname, join, resolve} from "path";
import {connectWorldWorker} from "../src/hosts/web";
import type {PixelSurfaceSize, PixelWorldDisplay, WorldWorker, WorldWorkerPage} from "../src/hosts/web";
import type {PixelPresenterSize} from "../src/backends/pixels";
import {createProjectServer} from "../src/hosts/desktop";
import type {ProjectServer} from "../src/hosts/desktop";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../src/engine/project/projectManifest";
import {EditorClient} from "../src/editor/page/editorClient";
import type {EditorChannel} from "../src/editor/page/editorClient";
import type {EditorRequest, EditorResultOf} from "../src/editor/editorProtocol";
import {HttpProjectFileSystem} from "../src/editor/project/httpProjectFileSystem";
import type {HttpRequestInit} from "../src/editor/project/httpProjectFileSystem";
import {serveProjectFiles} from "../src/editor/project/projectFileServing";
import type {ProjectFileServing, ProjectFilesPort} from "../src/editor/project/projectFileServing";
import {ServerEventStream} from "../src/editor/project/serverEvents";
import type {StreamingFetch, StreamingResponse} from "../src/editor/project/serverEvents";
import {
    isBuildSuccess,
    isGenerateProjectReport,
    isRebuiltEvent,
    PROJECT_EVENT_REBUILT,
    PROJECT_GENERATE_ROUTE,
    projectApiUrl,
} from "../src/editor/project/projectServerApi";
import type {BuildProjectResult, GenerateProjectReport, OpenProjectResult, RebuiltEvent} from "../src/editor/project/projectServerApi";
import type {GameTarget} from "../src/editor/project/editorSettings";
import {entityRemapOf} from "../src/editor/launch/projectRunner";
import {inputMapText, withBinding, withNewAction} from "../src/editor/page/inputMapDraft";
import {ProjectSettingsModel} from "../src/editor/page/projectSettingsModel";
import type {EditorNoticeLevel} from "../src/editor/page/editorSession";

const ROOT = resolve(__dirname, "..");
const DIST_FLAG = "--dist";
const SERVER_ORIGIN = "http://localhost";
const JSON_HEADERS: Readonly<Record<string, string>> = {"Content-Type": "application/json"};
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "projectSettings-fixture-";
const SURFACE: PixelPresenterSize = {widthPx: 320, heightPx: 192};
const WEB_PIXELS: GameTarget = {target: "web", backend: "pixels"};
const TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 20;
const MAIN_SCENE = "scenes/main.scene.json";
const SECOND_SCENE = "scenes/second.scene.json";
const INPUT_PATH = "assets/input.asset.json";
const GENERATED_GAME = "generated/game.ts";
const GENERATED_WEB_BOOTSTRAP = "generated/main.web.ts";
const MARKER_NAME = "marker";
const CAMERA_NAME = "camera";
const ADDED_ACTION = "dash";
const MANIFEST = {name: "Settings fixture", startScene: MAIN_SCENE, resources: [{type: "InputMap", path: INPUT_PATH}]};

function sceneText(name: string): string {
    return JSON.stringify({format: "jsengine-scene", version: 1, entities: [
        {id: 1, name: CAMERA_NAME, enabled: true, components: {LocalPosition: {xyz: [0, 0, 0]}, Camera: {nearPlaneDistance: 0.1, farPlaneDistance: 100}, LocalToWorld: {}, RenderBounds: {}}},
        {id: 2, name, enabled: true, components: {LocalPosition: {xyz: [1, 2, 0]}}},
    ]}, null, 2) + "\n";
}

const FIXTURE_FILES: Readonly<Record<string, string>> = {
    [PROJECT_MANIFEST_FILE]: JSON.stringify(MANIFEST, null, 2) + "\n",
    [MAIN_SCENE]: sceneText(MARKER_NAME),
    [SECOND_SCENE]: sceneText("second"),
    [INPUT_PATH]: inputMapText({fields: {actions: []}, actions: [{name: "jump", bindings: [{kind: "key", key: "Space"}], saved: {}}]}),
};

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string): void {
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

function serverFetch(server: ProjectServer) {
    return (url: string, init?: HttpRequestInit) => server.handle(new Request(new URL(url, SERVER_ORIGIN), init as RequestInit));
}

function streamingFetch(server: ProjectServer): StreamingFetch {
    return async (url, init) => await server.handle(new Request(new URL(url, SERVER_ORIGIN), init as RequestInit)) as unknown as StreamingResponse;
}

async function postJson<T>(server: ProjectServer, route: string, body: unknown): Promise<T> {
    const response = await serverFetch(server)(projectApiUrl(route), {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    const parsed = await response.json() as T & {error?: string};
    if (!response.ok) throw new Error(`${route}: ${parsed.error ?? response.status}`);
    return parsed;
}

class FrameCounter implements PixelWorldDisplay {
    public frames = 0;
    public readonly errors: string[] = [];

    public surfaceSize(): PixelSurfaceSize {
        return {kind: "pixels", ...SURFACE};
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public presentPixels(_frame: unknown, onPresented: () => void): void {
        this.frames++;
        setTimeout(onPresented, 0);
    }

    public showStatus(): void {
        return;
    }

    public hideStatus(): void {
    }

    public showError(text: string): void {
        this.errors.push(text);
    }
}

class EditorWorkerPage {
    public readonly display = new FrameCounter();
    public readonly client: EditorClient;
    public readonly workerErrors: string[] = [];
    private readonly connection: WorldWorkerPage;
    private readonly fileServing: ProjectFileServing;

    public constructor(bundlePath: string, files: HttpProjectFileSystem, name: string) {
        const worker = new Worker(bundlePath, {type: "module"});
        worker.addEventListener("error", event => this.workerErrors.push(event.message));
        this.fileServing = serveProjectFiles(worker as unknown as ProjectFilesPort, files);
        this.connection = connectWorldWorker(this.display, worker as unknown as WorldWorker, {name});
        this.client = new EditorClient(worker as unknown as EditorChannel, {timeoutMs: TIMEOUT_MS});
    }

    public ask<R extends EditorRequest>(request: R): Promise<EditorResultOf<R>> {
        return this.client.request(request);
    }

    public dispose(): void {
        this.client.close();
        this.fileServing.dispose();
        this.connection.close();
    }
}

function writeFixture(folder: string): void {
    for (const [path, text] of Object.entries(FIXTURE_FILES)) {
        const target = join(folder, ...path.split("/"));
        mkdirSync(dirname(target), {recursive: true});
        writeFileSync(target, text);
    }
}

async function verifyProjectSettingsSave(server: ProjectServer, folder: string): Promise<void> {
    const opened = await postJson<OpenProjectResult>(server, "open", {path: folder});
    expect(opened.validation.ok, `the fixture manifest validates (${JSON.stringify(opened.validation)})`);
    const id = opened.id;
    const built = await postJson<BuildProjectResult>(server, `${id}/build`, {gameTarget: WEB_PIXELS});
    const firstBundle = server.bundlePathOf(id);
    expect(isBuildSuccess(built) && firstBundle !== undefined, `the fixture builds for the editor (${JSON.stringify(built)})`);
    if (!isBuildSuccess(built) || firstBundle === undefined) return;

    const idle = await postJson<unknown>(server, `${id}/${PROJECT_GENERATE_ROUTE}`, {});
    expect(isGenerateProjectReport(idle) && idle.ok && idle.written.length === 0 && idle.unchanged.includes(GENERATED_GAME),
        `POST generate on a freshly built project writes nothing and lists ${GENERATED_GAME} as unchanged (${JSON.stringify(idle)})`);

    const events = new ServerEventStream(projectApiUrl(`${encodeURIComponent(id)}/events`), {fetch: streamingFetch(server)});
    const rebuilds: RebuiltEvent[] = [];
    events.on(PROJECT_EVENT_REBUILT, data => {
        if (isRebuiltEvent(data)) rebuilds.push(data);
    });
    const files = new HttpProjectFileSystem({projectId: id, rootLabel: "fixture", fetch: serverFetch(server), events});
    const page = new EditorWorkerPage(firstBundle, files, "the settings fixture");
    let reloaded: EditorWorkerPage | undefined;
    try {
        expect(await waitUntil(() => page.display.frames > 0), "the first editor worker presents frames");
        const before = await page.ask({op: "listEntities"});
        expect(before.entities.some(entity => entity.name === MARKER_NAME), `the editor worker loaded the start scene's ${MARKER_NAME}`);

        const reports: {level: EditorNoticeLevel, text: string}[] = [];
        const model = new ProjectSettingsModel({
            files: () => files,
            report: (level, text) => reports.push({level, text}),
            generate: () => postJson<GenerateProjectReport>(server, `${id}/${PROJECT_GENERATE_ROUTE}`, {}),
        });
        await model.load();
        const manifest = model.manifest;
        expect(manifest?.kind === "loaded" && model.inputMap.kind === "loaded", `the settings model loads the manifest and the bound input map (${JSON.stringify(model.inputMap.kind)})`);
        if (manifest?.kind !== "loaded" || model.inputMap.kind !== "loaded") return;
        await sleep(POLL_INTERVAL_MS);
        const rebuildsBeforeSave = rebuilds.length;
        model.setManifestDraft({...manifest.draft, startScene: SECOND_SCENE, targets: {...manifest.draft.targets, web: {declared: true, backend: "gpu", pixelScale: "2"}}});
        model.setInputMapDraft(withBinding(withNewAction(model.inputMap.draft, ADDED_ACTION), 1, {kind: "key", key: "Shift"}));
        expect(model.savable, "the edited manifest and input map can be saved");
        expect(await model.save(), `saving the project settings succeeds (${JSON.stringify(reports)})`);

        const savedManifest = validateProjectManifest(readFileSync(join(folder, PROJECT_MANIFEST_FILE), "utf8"));
        expect(savedManifest.ok && savedManifest.manifest.startScene === SECOND_SCENE && savedManifest.manifest.targets?.web?.backend === "gpu" && savedManifest.manifest.targets.web.pixelScale === 2,
            `jsengine.project.json on disk holds the new start scene and web target settings (${JSON.stringify(savedManifest)})`);
        const generateLine = reports.find(report => report.text.startsWith("jsengine generate wrote"));
        expect(generateLine !== undefined && generateLine.text.includes(GENERATED_GAME) && generateLine.text.includes(GENERATED_WEB_BOOTSTRAP),
            `the save ran generate, which rewrote ${GENERATED_GAME} and ${GENERATED_WEB_BOOTSTRAP} (${JSON.stringify(reports)})`);
        expect(readFileSync(join(folder, GENERATED_GAME), "utf8").includes(`"${SECOND_SCENE}"`), `${GENERATED_GAME} starts ${SECOND_SCENE}`);
        expect(readFileSync(join(folder, GENERATED_WEB_BOOTSTRAP), "utf8").includes(`{defaultBackend: "gpu"}`), `${GENERATED_WEB_BOOTSTRAP} defaults the page to the web target's backend`);
        expect(readFileSync(join(folder, INPUT_PATH), "utf8").includes(`"${ADDED_ACTION}"`), `${INPUT_PATH} holds the new action`);

        const rebuilt = await waitUntil(() => rebuilds.length > rebuildsBeforeSave);
        expect(rebuilt, "the manifest save makes the project server rebuild the editor worker (a rebuilt event)");
        const secondBundle = server.bundlePathOf(id);
        if (!rebuilt || secondBundle === undefined) return;
        expect(rebuilds[rebuilds.length - 1].workerUrl !== built.workerUrl, `the rebuilt event names a new worker version (${rebuilds[rebuilds.length - 1].workerUrl})`);
        expect(readFileSync(secondBundle, "utf8").includes(SECOND_SCENE), `the rebuilt editor worker bundles the regenerated start scene ${SECOND_SCENE}`);

        const exported = await page.ask({op: "exportSnapshot"});
        reloaded = new EditorWorkerPage(secondBundle, files, "the reloaded settings fixture");
        expect(await waitUntil(() => reloaded!.display.frames > 0), "the rebuilt editor worker presents frames");
        const imported = await reloaded.ask({
            op: "importSnapshot",
            documentText: exported.documentText,
            editSnapshotText: exported.editSnapshotText,
            editSnapshotRecords: exported.editSnapshotRecords,
            mode: exported.mode,
            gameplayTicks: exported.gameplayTicks,
        });
        const remap = entityRemapOf(exported.entities, imported.entities);
        expect(imported.entities.length === exported.entities.length && remap.size === exported.entities.length,
            `the reloaded worker takes the snapshot, entities carried over (${exported.entities.length} -> ${imported.entities.length})`);
        const {reloaded: inputReloaded} = await reloaded.ask({op: "reloadDataAsset", path: INPUT_PATH});
        const inputMap = await reloaded.ask({op: "getResource", typeName: "InputMap"});
        expect(inputReloaded && JSON.stringify(inputMap.fields).includes(`"${ADDED_ACTION}"`), `the saved input map reloads into the running world with ${ADDED_ACTION} (${JSON.stringify(inputMap.fields)})`);
        const errors = [...page.workerErrors, ...page.display.errors, ...reloaded.workerErrors, ...reloaded.display.errors];
        expect(errors.length === 0, `no worker errors${errors.length > 0 ? `: ${errors.join(" | ")}` : ""}`);
    } finally {
        reloaded?.dispose();
        page.dispose();
        events.close();
    }
}

async function main(): Promise<void> {
    if (typeof (globalThis as {Worker?: unknown}).Worker !== "function") {
        log("project settings check: skipped, this runtime has no Web Worker global");
        return;
    }
    if (process.argv.includes(DIST_FLAG)) {
        log("project settings check: skipped, a built site holds no project bundles");
        return;
    }
    if (process.versions.bun === undefined) {
        log("project settings check: skipped, building project workers needs bun");
        return;
    }
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    writeFixture(folder);
    const server = createProjectServer({repoRoot: ROOT, bun: {path: process.execPath}, browse: false});
    try {
        await verifyProjectSettingsSave(server, folder);
    } catch (error) {
        expect(false, `project settings: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    } finally {
        server.close();
        rmSync(folder, {recursive: true, force: true});
    }
    if (failures > 0) {
        console.error(`${failures} project settings failures`);
        process.exit(1);
    }
    log("project settings OK");
    process.exit(0);
}

void main();
