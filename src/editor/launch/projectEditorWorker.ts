import {registerBuiltinImageDecoders} from "../../engine/assets/image/builtinDecoders";
import {App} from "../../engine/core";
import type {DebugWorld, RequestedQuitHandling, System, SystemCtor} from "../../engine/core";
import type {Platform} from "../../engine/platform/platform";
import {Mesh} from "../../engine/rendering/3d/mesh";
import {activeRenderBackend} from "../../engine/rendering/renderBackend";
import {Input} from "../../engine/input";
import type {GpuCanvasPresenterFactory} from "../../backends/gpu/gpuCanvasPixelPresenter";
import {TerminalInput} from "../../hosts/terminalInput/terminalInput";
import type {KeyReporting} from "../../hosts/terminalInput/terminalInput";
import {PageConnection} from "../../hosts/web/worldWorkerPlatform";
import type {WorldWorkerScope} from "../../hosts/web/worldWorkerPlatform";
import {TerminalInputChannel} from "./terminalInputChannel";
import {SceneViewChannel} from "./sceneViewChannel";
import type {SceneViewScope} from "./sceneViewChannel";
import {EDITOR_SCHEMAS} from "../world/editorSchemas";
import {attachEditorWorldService} from "../world/editorWorldService";
import type {EditorServiceScope, EditorWorldService} from "../world/editorWorldService";
import {ProjectFileSource} from "../project/projectFileSource";
import type {StartProject} from "../../engine/project/startGame";
import type {ProjectFilesChannel} from "../project/projectFileSource";
import type {
    ProjectAssetFile,
    ProjectAssetFiles,
    ProjectLoadProgress,
    ProjectLoadProgressListener,
} from "../../engine/project/assetFiles";

type ProjectEditorWorkerScope = WorldWorkerScope & EditorServiceScope & ProjectFilesChannel & SceneViewScope;
type SystemList = readonly SystemCtor<System>[];

export interface ProjectSystemLists {
    readonly shared: SystemList;
    readonly backend: SystemList;
}

export interface EditorBackend {
    readonly canvasPresenter?: GpuCanvasPresenterFactory;
}

export type EditorBackendInstaller = (world: DebugWorld, page: PageConnection) => Promise<EditorBackend | void>;

const MESH_EXTENSION = ".obj";
const BYTES_PER_MB = 1024 * 1024;
const MB_DECIMALS = 1;
const SKIPPED_UNKNOWN_TYPES = "skip";
const TERMINAL_MOUSE_REPORTING = true;
const TERMINAL_KEY_REPORTING: KeyReporting = "legacy";
const REPORTED_SCHEMA_CHANGES = "report";
const QUIT_WITHOUT_EDITOR: RequestedQuitHandling = "proceed";

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function progressLine(progress: ProjectLoadProgress): string {
    const loaded = (progress.loadedBytes / BYTES_PER_MB).toFixed(MB_DECIMALS);
    const total = (progress.totalBytes / BYTES_PER_MB).toFixed(MB_DECIMALS);
    return `Loading project files: ${progress.loadedFiles}/${progress.totalFiles} files, ${loaded}/${total} MB`;
}

class SetupStatusAssetFiles implements ProjectAssetFiles {
    private reporting = true;
    private shown = "";

    public constructor(private readonly files: ProjectFileSource, private readonly page: PageConnection) {
    }

    public stopReporting(): void {
        this.reporting = false;
    }

    public list(): readonly ProjectAssetFile[] {
        return this.files.list();
    }

    public ensureLoaded(paths: readonly string[], onProgress?: ProjectLoadProgressListener): Promise<void> {
        return this.files.ensureLoaded(paths, this.reported(onProgress));
    }

    public loadFetchingAsNeeded<T>(load: () => T, onProgress?: ProjectLoadProgressListener): Promise<T> {
        return this.files.loadFetchingAsNeeded(load, this.reported(onProgress));
    }

    private reported(onProgress: ProjectLoadProgressListener | undefined): ProjectLoadProgressListener {
        return progress => {
            onProgress?.(progress);
            if (!this.reporting) return;
            const line = progressLine(progress);
            if (line === this.shown) return;
            this.shown = line;
            this.page.showStatus(line);
        };
    }
}

export async function preloadProjectAssets(files: ProjectFileSource, platform: Platform, paths: readonly string[]): Promise<void> {
    for (const path of new Set(paths)) {
        try {
            if (path.toLowerCase().endsWith(MESH_EXTENSION)) await files.loadFetchingAsNeeded(() => Mesh.fromFile(path, {files, inflate: platform.inflate}));
            else await files.ensureLoaded([path]);
        } catch (error) {
            console.warn(`Could not preload ${path}: ${describeError(error)}`);
        }
    }
}

async function startProjectWorld(
    scope: ProjectEditorWorkerScope,
    page: PageConnection,
    files: ProjectFileSource,
    sceneView: SceneViewChannel,
    startProject: StartProject,
    systemLists: ProjectSystemLists,
    installBackend: EditorBackendInstaller,
): Promise<void> {
    registerBuiltinImageDecoders();
    let editorService: EditorWorldService | undefined;
    const app = new App({platform: page.platform, handleRequestedQuit: () => editorService?.handleRequestedQuit() ?? QUIT_WITHOUT_EDITOR});
    const world = app.createDebugWorld();
    const installed = await installBackend(world, page);
    const backendSystems = systemLists.backend;
    await files.whenListed();
    const input = world.resources.getOrCreate(Input);
    page.connectInput(input);
    new TerminalInput({
        terminal: new TerminalInputChannel(scope),
        platform: page.platform,
        sink: input,
        mouse: TERMINAL_MOUSE_REPORTING,
        keyReporting: TERMINAL_KEY_REPORTING,
    }).start();
    const assetFiles = new SetupStatusAssetFiles(files, page);
    const preloadAssets = (paths: readonly string[]) => preloadProjectAssets(files, world.platform, paths);
    const game = await startProject(world, {
        files: assetFiles,
        preload: preloadAssets,
        backendSystems,
        hostSchemas: EDITOR_SCHEMAS,
        unknownComponentTypes: SKIPPED_UNKNOWN_TYPES,
        schemaChanges: REPORTED_SCHEMA_CHANGES,
    });
    assetFiles.stopReporting();
    const service = attachEditorWorldService(scope, world, game.registry, {
        preloadAssets,
        scenes: game.scenes,
        gameplaySystems: [...backendSystems, ...systemLists.shared],
        refetchFiles: paths => files.refetch(paths),
        onFirstFrame: () => page.reportReady(),
    });
    editorService = service;
    const backend = activeRenderBackend(world);
    if (backend === undefined) return;
    sceneView.attach({
        backend,
        ...(installed?.canvasPresenter === undefined ? {} : {canvasPresenter: installed.canvasPresenter}),
        open: (view, presenter) => service.showSceneView(view, presenter),
        close: view => service.closeSceneView(view),
    });
}

export function runProjectEditorWorker(startProject: StartProject, systemLists: ProjectSystemLists, installBackend: EditorBackendInstaller): void {
    const scope = globalThis as unknown as ProjectEditorWorkerScope;
    const files = new ProjectFileSource(scope);
    const sceneView = new SceneViewChannel(scope);
    void PageConnection.open(scope, files).then(async page => {
        try {
            await startProjectWorld(scope, page, files, sceneView, startProject, systemLists, installBackend);
        } catch (error) {
            console.error(error);
            page.fail(error);
        }
    });
}
