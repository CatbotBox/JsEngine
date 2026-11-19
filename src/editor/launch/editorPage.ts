import {installDomInput} from "../../hosts/web/domInput";
import {gpuFallbackWarning, webGpuUsable} from "../../hosts/web/renderBackendBootstrap";
import {renderBackendFromQuery} from "../../hosts/web/worldWorkerProtocol";
import {createEditorShell} from "../page/editorShell";
import {DirectoryHandleProjectFileSystem} from "../project/directoryHandleProjectFileSystem";
import type {DirectoryHandleLike} from "../project/directoryHandleProjectFileSystem";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import type {ProjectManifest} from "../../engine/project/projectManifest";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import {
    isBuildFailedEvent,
    isBuildSuccess,
    isRebuiltEvent,
    PROJECT_BUILD_COPY_PATH,
    PROJECT_EVENT_BUILD_FAILED,
    PROJECT_EVENT_REBUILT,
} from "../project/projectServerApi";
import type {BuildProjectResult, OpenProjectResult} from "../project/projectServerApi";
import type {ServerEventStream} from "../project/serverEvents";
import {chooseEditorRenderBackend, EDITOR_DEFAULT_RENDER_BACKEND, editorViewportFromQuery, renderBackendLabelText} from "./editorViewport";
import type {EditorRenderBackend} from "./editorViewport";
import {EditorExtensionLoader} from "./editorExtensionLoader";
import {browseForFolder} from "./folderBrowser";
import {ProjectRunner} from "./projectRunner";
import {ProjectServerClient} from "./projectServerClient";
import {browserStorageOrUndefined, forgetRecentProject, readRecentProjects, rememberRecentProject} from "./recentProjects";
import {SAMPLE_PROJECTS, StartScreen} from "./startScreen";
import type {StartScreenAction} from "./startScreen";

export const PROJECT_QUERY_PARAMETER = "project";

export type EditorPageState = "start" | "loading" | "ready" | "failed" | "stopped";

const EDITOR_STATE_KEY = "editorState";
const EDITOR_VIEWPORT_KEY = "editorViewport";
const RENDER_BACKEND_KEY = "renderBackend";
const GPU_BACKEND: EditorRenderBackend = "gpu";
const EDITOR_TITLE_SUFFIX = " - JsEngine editor";
const SCRIPT_TYPE = "text/javascript";
const ABORT_ERROR_NAME = "AbortError";
const PATH_SEPARATORS = /[\\/]+/;
const SERVER_MODE_NOTE = "Pick any folder: a JsEngine project has a jsengine.project.json naming its entry module. Its code is built for the editor on open and rebuilt when it changes.";
const SERVER_WITHOUT_BUILD_NOTE = "This host cannot build project code";
const BROWSER_MODE_NOTE = "No dev server: projects open through the browser's folder access, and only projects whose code is already bundled can run.";
const NOT_BUNDLED = "This project's code is not bundled. Open it with the dev server (bun run editor:web) or the desktop editor (bun run editor:window) to build it.";
const CREATE_NEEDS_SERVER = "Creating a project needs the dev server (bun run editor:web) or the desktop editor (bun run editor:window).";
const NO_FOLDER_ACCESS = "This browser cannot open folders (it has no File System Access API). Use a Chromium-based browser, the dev server (bun run editor:web) or the desktop editor (bun run editor:window).";
const BUILD_WARNINGS_TITLE = "The game code built with warnings:";
const PROJECT_QUERY_NEEDS_SERVER ="?project= opens a folder on the dev server or in the desktop editor, and neither is answering here.";

interface ProjectLaunch {
    readonly manifest: ProjectManifest;
    readonly files: ProjectFileSystem;
    readonly workerUrl: string;
    readonly buildWarnings?: readonly string[];
    readonly events?: ServerEventStream;
    readonly editorExtensionsUrl?: string;
}

interface DirectoryPickerWindow {
    showDirectoryPicker?: (options?: {readonly mode?: "read" | "readwrite"}) => Promise<DirectoryHandleLike>;
}

function setPageState(state: EditorPageState): void {
    document.documentElement.dataset[EDITOR_STATE_KEY] = state;
}

async function editorRenderBackend(search: string): Promise<EditorRenderBackend> {
    const requested = renderBackendFromQuery(search, EDITOR_DEFAULT_RENDER_BACKEND);
    const usable = requested === GPU_BACKEND && await webGpuUsable(navigator, HTMLCanvasElement.prototype);
    const choice = chooseEditorRenderBackend(requested, usable);
    if (choice.fallbackReason !== undefined) console.warn(gpuFallbackWarning(choice.fallbackReason));
    return choice.backend;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function folderName(path: string): string {
    const parts = path.split(PATH_SEPARATORS).filter(part => part.length > 0);
    return parts[parts.length - 1] ?? path;
}

function modeNote(server: ProjectServerClient | undefined): string {
    if (server === undefined) return BROWSER_MODE_NOTE;
    const capabilities = server.capabilities;
    if (capabilities.build) return SERVER_MODE_NOTE;
    return `${SERVER_WITHOUT_BUILD_NOTE}: ${capabilities.buildUnavailableReason ?? "no reason given"}`;
}

class EditorStart {
    private readonly storage = browserStorageOrUndefined();
    private readonly screen: StartScreen;

    public constructor(private readonly server: ProjectServerClient | undefined) {
        this.screen = new StartScreen(document.body, {
            openProject: () => void this.chooseFolder(),
            openRecent: project => void this.openServerProject(project.path),
            forgetRecent: project => this.screen.showRecent(forgetRecentProject(this.storage, project.path)),
            openSample: sample => void this.openServerProject(sample.path),
            samples: server?.capabilities.build === true ? SAMPLE_PROJECTS : [],
            modeNote: modeNote(server),
        });
        this.screen.showRecent(server === undefined ? [] : readRecentProjects(this.storage));
    }

    public async openFromQuery(path: string): Promise<void> {
        if (this.server === undefined) {
            this.fail("Cannot open the project", [PROJECT_QUERY_NEEDS_SERVER]);
            return;
        }
        await this.openServerProject(path);
    }

    private backAction(): StartScreenAction {
        return {
            label: "Back",
            run: () => {
                this.screen.clearMessage();
                setPageState("start");
            },
        };
    }

    private fail(title: string, problems: readonly string[], actions: readonly StartScreenAction[] = [this.backAction()]): void {
        setPageState("failed");
        this.screen.showProblems(title, problems, actions);
    }

    private async chooseFolder(): Promise<void> {
        const server = this.server;
        try {
            if (server?.capabilities.pickFolder === true) {
                const path = await server.pickFolder();
                if (path !== null) await this.openServerProject(path);
            } else if (server?.capabilities.browse === true) {
                const path = await browseForFolder(document.body, requested => server.browse(requested));
                if (path !== null) await this.openServerProject(path);
            } else {
                await this.openWithDirectoryPicker();
            }
        } catch (error) {
            this.fail("Could not open a folder", [describeError(error)]);
        }
    }

    private async openServerProject(path: string): Promise<void> {
        const server = this.server;
        if (server === undefined) return;
        setPageState("loading");
        this.screen.showBusy(`Opening ${path}…`);
        let opened: OpenProjectResult;
        try {
            opened = await server.open(path);
        } catch (error) {
            this.fail(`Could not open ${path}`, [describeError(error)]);
            return;
        }
        await this.buildAndLaunch(server, opened);
    }

    private async createProject(server: ProjectServerClient, path: string): Promise<void> {
        const name = window.prompt("Name of the new project", folderName(path))?.trim();
        if (name === undefined || name.length === 0) return;
        setPageState("loading");
        this.screen.showBusy(`Creating ${name} in ${path}…`);
        let created: OpenProjectResult;
        try {
            created = await server.create(path, name);
        } catch (error) {
            this.fail(`Could not create a project in ${path}`, [describeError(error)]);
            return;
        }
        await this.buildAndLaunch(server, created);
    }

    private async buildAndLaunch(server: ProjectServerClient, opened: OpenProjectResult): Promise<void> {
        const validation = opened.validation;
        if (!validation.ok) {
            this.fail(`${opened.path} is not a JsEngine project`, validation.problems, [
                {label: "Create project here", run: () => void this.createProject(server, opened.path)},
                this.backAction(),
            ]);
            return;
        }
        const manifest = validation.manifest;
        this.screen.showRecent(rememberRecentProject(this.storage, opened.path, manifest.name, Date.now()));
        this.screen.showBusy(`Building ${manifest.name}…`);
        let built: BuildProjectResult;
        try {
            built = await server.build(opened.id);
        } catch (error) {
            this.fail(`Could not build ${manifest.name}`, [describeError(error)]);
            return;
        }
        if (!isBuildSuccess(built)) {
            this.fail(`Could not build ${manifest.name}`, built.errors, [
                {label: "Try again", run: () => void this.openServerProject(opened.path)},
                this.backAction(),
            ]);
            return;
        }
        const events = server.events(opened.id);
        const files = server.files(opened.id, folderName(opened.path), events);
        await this.launch({manifest, files, workerUrl: built.workerUrl, buildWarnings: built.warnings, events, editorExtensionsUrl: built.editorExtensionsUrl});
    }

    private async openWithDirectoryPicker(): Promise<void> {
        const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker;
        if (picker === undefined) {
            this.fail("Cannot open folders here", [NO_FOLDER_ACCESS]);
            return;
        }
        let handle: DirectoryHandleLike;
        try {
            handle = await picker({mode: "readwrite"});
        } catch (error) {
            if (error instanceof Error && error.name === ABORT_ERROR_NAME) return;
            throw error;
        }
        setPageState("loading");
        this.screen.showBusy(`Opening ${handle.name}…`);
        const files = new DirectoryHandleProjectFileSystem(handle);
        const manifestText = await files.readText(PROJECT_MANIFEST_FILE).catch(() => undefined);
        const filePaths = new Set((await files.list()).filter(entry => entry.kind === "file").map(entry => entry.path));
        const validation = validateProjectManifest(manifestText, path => filePaths.has(path));
        if (!validation.ok) {
            this.fail(`${handle.name} is not a JsEngine project`, [...validation.problems, CREATE_NEEDS_SERVER]);
            return;
        }
        const bundle = await files.read(PROJECT_BUILD_COPY_PATH).catch(() => undefined);
        if (bundle === undefined) {
            this.fail(`${validation.manifest.name} cannot run here`, [NOT_BUNDLED]);
            return;
        }
        const workerUrl = URL.createObjectURL(new Blob([bundle as Uint8Array<ArrayBuffer>], {type: SCRIPT_TYPE}));
        await this.launch({manifest: validation.manifest, files, workerUrl});
    }

    private async launch(launch: ProjectLaunch): Promise<void> {
        const renderBackend = await editorRenderBackend(location.search);
        this.screen.remove();
        const name = launch.manifest.name;
        document.title = name + EDITOR_TITLE_SUFFIX;
        const shell = createEditorShell(document.body, {renderBackendLabel: renderBackendLabelText(renderBackend)});
        shell.viewport.dataset[EDITOR_VIEWPORT_KEY] = "";
        const viewport = editorViewportFromQuery(renderBackend, shell.viewport, location.search);
        document.documentElement.dataset[RENDER_BACKEND_KEY] = renderBackend;
        const runner = new ProjectRunner({
            shell,
            viewport,
            files: launch.files,
            project: {name, startScene: launch.manifest.startScene ?? null},
            search: location.search,
            onReady: () => setPageState("ready"),
            onStopped: () => setPageState("stopped"),
        });
        installDomInput(shell.viewport, {sink: runner.input, cellArea: () => viewport.cellArea()});
        window.addEventListener("pagehide", () => runner.exit());
        let shownWarnings = "";
        const showBuildWarnings = (warnings: readonly string[]) => {
            const text = warnings.join("\n");
            if (text === shownWarnings) return;
            shownWarnings = text;
            if (warnings.length > 0) shell.notice("warn", `${BUILD_WARNINGS_TITLE}\n${text}`);
        };
        showBuildWarnings(launch.buildWarnings ?? []);
        const extensions = new EditorExtensionLoader({reportError: text => shell.notice("error", text)});
        let extensionsUrl = launch.editorExtensionsUrl;
        let sessionStarted = false;
        launch.events?.on(PROJECT_EVENT_REBUILT, data => {
            if (!isRebuiltEvent(data)) return;
            showBuildWarnings(data.warnings);
            runner.reload(data.workerUrl);
            extensionsUrl = data.editorExtensionsUrl;
            if (sessionStarted) void extensions.load(extensionsUrl);
        });
        launch.events?.on(PROJECT_EVENT_BUILD_FAILED, data => {
            if (isBuildFailedEvent(data)) shell.notice("error", `The game code did not build:\n${data.errors.join("\n")}`);
        });
        try {
            await runner.start(launch.workerUrl);
        } catch (error) {
            setPageState("failed");
            viewport.showError(describeError(error));
            return;
        }
        sessionStarted = true;
        await extensions.load(extensionsUrl);
    }
}

export async function startEditorPage(): Promise<void> {
    const project = new URLSearchParams(location.search).get(PROJECT_QUERY_PARAMETER)?.trim() ?? "";
    setPageState(project.length > 0 ? "loading" : "start");
    const server = await ProjectServerClient.connect();
    const start = new EditorStart(server);
    if (project.length > 0) await start.openFromQuery(project);
}
