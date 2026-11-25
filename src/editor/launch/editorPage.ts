import {errorFramesOf} from "../../engine/debugging/errorStack";
import {installDomInput, keyOf} from "../../hosts/web/domInput";
import {webGpuUsable} from "../../hosts/web/renderBackendBootstrap";
import {askForText} from "../page/dialogs";
import {createEditorShell} from "../page/editorShell";
import type {ProjectBuildServices} from "../page/editorShell";
import {DirectoryHandleProjectFileSystem} from "../project/directoryHandleProjectFileSystem";
import type {DirectoryHandleLike} from "../project/directoryHandleProjectFileSystem";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../../engine/project/projectManifest";
import type {ProjectManifest} from "../../engine/project/projectManifest";
import {targetRenderDefaults} from "../../engine/project/projectTargets";
import type {ProjectTargets} from "../../engine/project/projectTargets";
import {EDITOR_SETTINGS_FILE, gameTargetKey, parseEditorSettings, sameGameTarget} from "../project/editorSettings";
import type {EditorSettings, GameTarget} from "../project/editorSettings";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import {
    isBuildFailedEvent,
    isBuildSuccess,
    isRebuiltEvent,
    PROJECT_EVENT_BUILD_FAILED,
    PROJECT_EVENT_REBUILT,
} from "../project/projectServerApi";
import {readPrebuiltProjectCode} from "../project/prebuiltProjectCode";
import type {BuildProjectResult, GenerateProjectReport, OpenProjectResult} from "../project/projectServerApi";
import {SAMPLE_PROJECTS} from "../project/sampleProjects";
import type {ServerEventStream} from "../project/serverEvents";
import {editorViewportFor, sceneViewportFor} from "./editorViewport";
import {EditorExtensionLoader} from "./editorExtensionLoader";
import {browseForFolder} from "./folderBrowser";
import {addressKeepingBackendOverride, chooseGameTarget, gameTargetLabelText, gpuFallbackNotice, projectGameTarget, registerGameTargetCommand, webGpuAvailability} from "./gameTargets";
import type {GameTargetChoice, WebGpuAvailability} from "./gameTargets";
import {ProjectRunner} from "./projectRunner";
import {ProjectServerClient} from "./projectServerClient";
import {browserStorageOrUndefined, forgetRecentProject, readRecentProjects, rememberRecentProject} from "./recentProjects";
import {StartScreen} from "./startScreen";
import type {StartScreenAction} from "./startScreen";

export const PROJECT_QUERY_PARAMETER = "project";

export type EditorPageState = "start" | "loading" | "ready" | "failed" | "stopped";

const EDITOR_STATE_KEY = "editorState";
const RENDER_BACKEND_KEY = "renderBackend";
const GAME_TARGET_KEY = "gameTarget";
const EDITOR_TITLE_SUFFIX = " - JsEngine editor";
const SCRIPT_TYPE = "text/javascript";
const ABORT_ERROR_NAME = "AbortError";
const PATH_SEPARATORS = /[\\/]+/;
const NO_SETTINGS: EditorSettings = {};
const SERVER_MODE_NOTE = "Pick any folder: a JsEngine project has a jsengine.project.json naming its entry module. Its code is built for the editor on open and rebuilt when it changes.";
const SERVER_WITHOUT_BUILD_NOTE = "This host cannot build project code";
const BROWSER_MODE_NOTE = "No dev server: projects open through the browser's folder access, and only projects whose code is already bundled can run.";
const NOT_BUNDLED = "Open it with the dev server (jsengine edit) or the desktop editor (jsengine edit --target window) to build it, or pick another target there.";
const CREATE_NEEDS_SERVER = "Creating a project needs the dev server (jsengine edit) or the desktop editor (jsengine edit --target window).";
const NO_FOLDER_ACCESS = "This browser cannot open folders (it has no File System Access API). Use a Chromium-based browser, the dev server (jsengine edit) or the desktop editor (jsengine edit --target window).";
const BUILD_WARNINGS_TITLE = "The game code built with warnings:";
const PROJECT_QUERY_NEEDS_SERVER ="?project= opens a folder on the dev server or in the desktop editor, and neither is answering here.";
const SWITCH_NEEDS_SERVER = "Switching the target rebuilds the game code, which needs the dev server (jsengine edit) or the desktop editor (jsengine edit --target window)";
const NEW_PROJECT_TITLE = "New project";
const PROJECT_NAME_LABEL = "Name of the new project";
const CREATE_PROJECT_TEXT = "Create";
const PROJECT_NAME_NEEDED = "Name the project";

interface TargetSwitching {
    remember(gameTarget: GameTarget): Promise<void>;
    build(gameTarget: GameTarget): Promise<BuildProjectResult>;
}

interface ProjectLaunch {
    readonly manifest: ProjectManifest;
    readonly files: ProjectFileSystem;
    readonly workerUrl: string;
    readonly target: GameTargetChoice;
    readonly switching?: TargetSwitching;
    readonly buildWarnings?: readonly string[];
    readonly events?: ServerEventStream;
    readonly editorExtensionsUrl?: string;
    readonly launchWarnings?: readonly string[];
    readonly generate?: () => Promise<GenerateProjectReport>;
    readonly projectBuild?: ProjectBuildServices;
}

interface DirectoryPickerWindow {
    showDirectoryPicker?: (options?: {readonly mode?: "read" | "readwrite"}) => Promise<DirectoryHandleLike>;
}

function setPageState(state: EditorPageState): void {
    document.documentElement.dataset[EDITOR_STATE_KEY] = state;
}

function showGameTarget(gameTarget: GameTarget): void {
    document.documentElement.dataset[RENDER_BACKEND_KEY] = gameTarget.backend;
    document.documentElement.dataset[GAME_TARGET_KEY] = gameTargetKey(gameTarget);
}

async function pageWebGpuAvailability(): Promise<WebGpuAvailability> {
    return webGpuAvailability(await webGpuUsable(navigator, HTMLCanvasElement.prototype));
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function scriptUrlOf(bytes: Uint8Array): string {
    return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], {type: SCRIPT_TYPE}));
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

    public constructor(private readonly server: ProjectServerClient | undefined, private readonly webGpu: WebGpuAvailability) {
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
            id: "back",
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

    private chooseTarget(settings: EditorSettings, manifest: ProjectManifest): GameTargetChoice {
        return chooseGameTarget(settings.gameTarget, location.search, this.webGpu, projectGameTarget(manifest.targets));
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
        const name = (await askForText(document, {
            title: NEW_PROJECT_TITLE,
            label: PROJECT_NAME_LABEL,
            initialValue: folderName(path),
            confirmText: CREATE_PROJECT_TEXT,
            validate: value => value.trim().length === 0 ? PROJECT_NAME_NEEDED : undefined,
        }))?.trim();
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
                {id: "createProject", label: "Create project here", run: () => void this.createProject(server, opened.path)},
                this.backAction(),
            ]);
            return;
        }
        const manifest = validation.manifest;
        this.screen.showRecent(rememberRecentProject(this.storage, opened.path, manifest.name, Date.now()));
        this.screen.showBusy(`Building ${manifest.name}…`);
        const target = this.chooseTarget(await server.editorSettings(opened.id).catch(() => NO_SETTINGS), manifest);
        let built: BuildProjectResult;
        try {
            built = await server.build(opened.id, target.gameTarget);
        } catch (error) {
            this.fail(`Could not build ${manifest.name}`, [describeError(error)]);
            return;
        }
        if (!isBuildSuccess(built)) {
            this.fail(`Could not build ${manifest.name}`, built.errors, [
                {id: "retry", label: "Try again", run: () => void this.openServerProject(opened.path)},
                this.backAction(),
            ]);
            return;
        }
        const events = server.events(opened.id);
        const files = server.files(opened.id, folderName(opened.path), events);
        const switching: TargetSwitching = {
            remember: async gameTarget => {
                await server.updateEditorSettings(opened.id, {gameTarget});
            },
            build: gameTarget => server.build(opened.id, gameTarget),
        };
        const launched = {...target, gameTarget: built.gameTarget};
        const generate = () => server.generate(opened.id);
        const unavailableReason = server.capabilities.buildUnavailableReason;
        const projectBuild: ProjectBuildServices = {
            targetReport: buildTarget => server.targetReport(opened.id, buildTarget),
            packageProject: () => server.packageProject(opened.id),
            ...(unavailableReason === undefined ? {} : {unavailableReason}),
        };
        await this.launch({manifest, files, workerUrl: built.workerUrl, target: launched, switching, buildWarnings: built.warnings, events, editorExtensionsUrl: built.editorExtensionsUrl, generate, projectBuild});
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
        const target = this.chooseTarget(parseEditorSettings(await files.readText(EDITOR_SETTINGS_FILE).catch(() => undefined)), validation.manifest);
        const code = await readPrebuiltProjectCode(files, validation.manifest, target.gameTarget);
        if (code.worker === undefined) {
            const missing = `The code of ${validation.manifest.name} is not bundled for ${gameTargetLabelText(target.gameTarget)} (no ${code.workerPath}).`;
            this.fail(`${validation.manifest.name} cannot run here`, [missing, NOT_BUNDLED]);
            return;
        }
        const editorExtensionsUrl = code.editorExtensions === undefined ? {} : {editorExtensionsUrl: scriptUrlOf(code.editorExtensions)};
        await this.launch({manifest: validation.manifest, files, workerUrl: scriptUrlOf(code.worker), target, launchWarnings: code.warnings, ...editorExtensionsUrl});
    }

    private async launch(launch: ProjectLaunch): Promise<void> {
        this.screen.remove();
        const name = launch.manifest.name;
        document.title = name + EDITOR_TITLE_SUFFIX;
        const initialTarget = launch.target.gameTarget;
        const shell = createEditorShell(document.body, {
            targetLabel: gameTargetLabelText(initialTarget),
            closeProject: () => location.assign(addressKeepingBackendOverride(location.pathname, location.search)),
            keyOfEvent: keyOf,
            ...(launch.generate === undefined ? {} : {generate: launch.generate}),
            ...(launch.projectBuild === undefined ? {} : {projectBuild: launch.projectBuild}),
        });
        let projectTargets: ProjectTargets | undefined = launch.manifest.targets;
        const pixelScaleOf = (gameTarget: GameTarget): number | undefined => targetRenderDefaults(projectTargets, gameTarget.target).pixelScale;
        launch.files.onChange(change => {
            if (!change.paths.includes(PROJECT_MANIFEST_FILE)) return;
            void launch.files.readText(PROJECT_MANIFEST_FILE).then(text => {
                const validation = validateProjectManifest(text);
                if (!validation.ok) return;
                projectTargets = validation.manifest.targets;
                document.title = validation.manifest.name + EDITOR_TITLE_SUFFIX;
            }, () => undefined);
        });
        const fallbackReason = launch.target.fallbackReason;
        if (fallbackReason !== undefined) {
            const notice = gpuFallbackNotice(initialTarget, fallbackReason);
            console.warn(notice);
            shell.notice("warn", notice);
        }
        showGameTarget(initialTarget);
        const runner = new ProjectRunner({
            shell,
            gameTarget: initialTarget,
            gameContainer: shell.viewport,
            viewportFor: (gameTarget, container, visible) => editorViewportFor(gameTarget, container, location.search, visible, pixelScaleOf(gameTarget)),
            sceneViewportFor: (gameTarget, container, visible) => sceneViewportFor(gameTarget, container, location.search, visible, pixelScaleOf(gameTarget)),
            onTargetChanged: gameTarget => {
                shell.showTargetLabel(gameTargetLabelText(gameTarget));
                showGameTarget(gameTarget);
            },
            files: launch.files,
            project: {name, startScene: launch.manifest.startScene ?? null},
            search: location.search,
            onReady: () => setPageState("ready"),
            onStopped: () => setPageState("stopped"),
        });
        installDomInput(shell.viewport, {sink: runner.input, cellArea: () => runner.cellArea()});
        shell.watchSceneViews(runner.sceneViews);
        window.addEventListener("pagehide", () => runner.exit());
        let desiredTarget = initialTarget;
        const switchTarget = async (gameTarget: GameTarget): Promise<void> => {
            const switching = launch.switching;
            if (switching === undefined) return;
            if (sameGameTarget(gameTarget, desiredTarget) && sameGameTarget(gameTarget, runner.gameTarget)) return;
            desiredTarget = gameTarget;
            const label = gameTargetLabelText(gameTarget);
            await switching.remember(gameTarget).catch(error => shell.notice("warn", `Could not remember the target in ${EDITOR_SETTINGS_FILE}: ${describeError(error)}`));
            shell.notice("info", `Building the game code for ${label}...`);
            let built: BuildProjectResult;
            try {
                built = await switching.build(gameTarget);
            } catch (error) {
                shell.notice("error", `Could not build the game code for ${label}: ${describeError(error)}`, errorFramesOf(error));
                return;
            }
            if (!isBuildSuccess(built)) {
                shell.notice("error", `The game code did not build for ${label}:\n${built.errors.join("\n")}`);
                return;
            }
            showBuildWarnings(built.warnings);
            if (sameGameTarget(built.gameTarget, desiredTarget)) runner.reload(built);
        };
        const targets = registerGameTargetCommand(shell.commands, {
            current: () => runner.gameTarget,
            webGpu: this.webGpu,
            ...(launch.switching === undefined ? {switchUnavailableReason: SWITCH_NEEDS_SERVER} : {}),
            choose: gameTarget => void switchTarget(gameTarget),
        });
        shell.setGameTargetMenu(targets.menuEntries);
        let shownWarnings = "";
        const showBuildWarnings = (warnings: readonly string[]) => {
            const text = warnings.join("\n");
            if (text === shownWarnings) return;
            shownWarnings = text;
            if (warnings.length > 0) shell.notice("warn", `${BUILD_WARNINGS_TITLE}\n${text}`);
        };
        showBuildWarnings(launch.buildWarnings ?? []);
        for (const warning of launch.launchWarnings ?? []) shell.notice("warn", warning);
        const extensions = new EditorExtensionLoader({reportError: text => shell.notice("error", text)});
        let extensionsUrl = launch.editorExtensionsUrl;
        let sessionStarted = false;
        launch.events?.on(PROJECT_EVENT_REBUILT, data => {
            if (!isRebuiltEvent(data) || !sameGameTarget(data.gameTarget, desiredTarget)) return;
            showBuildWarnings(data.warnings);
            runner.reload(data);
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
            runner.showError(describeError(error));
            return;
        }
        sessionStarted = true;
        await extensions.load(extensionsUrl);
    }
}

export async function startEditorPage(): Promise<void> {
    const project = new URLSearchParams(location.search).get(PROJECT_QUERY_PARAMETER)?.trim() ?? "";
    setPageState(project.length > 0 ? "loading" : "start");
    const [server, webGpu] = await Promise.all([ProjectServerClient.connect(), pageWebGpuAvailability()]);
    const start = new EditorStart(server, webGpu);
    if (project.length > 0) await start.openFromQuery(project);
}
