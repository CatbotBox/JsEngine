import {DebugWorld} from "../../engine/core";
import {Input} from "../../engine/input";
import type {Platform} from "../../engine/platform/platform";
import {Mesh} from "../../engine/rendering/3d/mesh";
import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../engine/scene";
import {registerCellsComponentSchemas} from "../../backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../backends/pixels/pixelsComponentSchemas";
import {PixelPresenterResource} from "../../backends/pixels/pixelPresenterResource";
import {registerGpuComponentSchemas} from "../../backends/gpu/gpuComponentSchemas";
import {PageConnection} from "../../hosts/web/worldWorkerPlatform";
import type {WorldWorkerScope} from "../../hosts/web/worldWorkerPlatform";
import {gpuCanvasPresenter, requestGpuDevice} from "../../hosts/web/gpuWorldDevice";
import {attachEditorWorldService, editorSceneManager} from "../world/editorWorldService";
import type {EditorServiceScope} from "../world/editorWorldService";
import {ProjectFileSource} from "../project/projectFileSource";
import type {ProjectFilesChannel} from "../project/projectFileSource";
import type {
    ProjectAssetFile,
    ProjectAssetFiles,
    ProjectEntryModule,
    ProjectLoadProgress,
    ProjectLoadProgressListener,
    ProjectRenderBackend,
} from "../project/projectEntry";

type ProjectEditorWorkerScope = WorldWorkerScope & EditorServiceScope & ProjectFilesChannel;

const MESH_EXTENSION = ".obj";
const BYTES_PER_MB = 1024 * 1024;
const MB_DECIMALS = 1;
const GPU_BACKEND: ProjectRenderBackend = "gpu";
const PIXELS_BACKEND: ProjectRenderBackend = "pixels";

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

export function projectComponentSchemas(entry: ProjectEntryModule): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerCellsComponentSchemas(registry);
    registerPixelsComponentSchemas(registry);
    registerGpuComponentSchemas(registry);
    entry.registerProjectSchemas(registry);
    return registry;
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

async function insertPresenter(world: DebugWorld, page: PageConnection): Promise<ProjectRenderBackend> {
    if (page.renderBackend() !== GPU_BACKEND) {
        world.resources.insert(new PixelPresenterResource(page.pixelPresenter()));
        return PIXELS_BACKEND;
    }
    const gpu = await requestGpuDevice(page);
    world.resources.insert(gpu);
    world.resources.insert(new PixelPresenterResource(gpuCanvasPresenter(page, gpu)));
    return GPU_BACKEND;
}

async function startProjectWorld(scope: ProjectEditorWorkerScope, page: PageConnection, files: ProjectFileSource, entry: ProjectEntryModule): Promise<void> {
    const registry = projectComponentSchemas(entry);
    const world = new DebugWorld({platform: page.platform});
    const renderBackend = await insertPresenter(world, page);
    await files.whenListed();
    page.connectInput(world.resources.getOrCreate(Input));
    const assetFiles = new SetupStatusAssetFiles(files, page);
    const preloadAssets = (paths: readonly string[]) => preloadProjectAssets(files, world.platform, paths);
    const scenes = editorSceneManager(world, registry, preloadAssets);
    await entry.setupProject(world, {files: assetFiles, renderBackend, scenes, quit: () => page.quit()});
    assetFiles.stopReporting();
    attachEditorWorldService(scope, world, registry, {preloadAssets, scenes});
}

export function runProjectEditorWorker(entry: ProjectEntryModule): void {
    const scope = globalThis as unknown as ProjectEditorWorkerScope;
    const files = new ProjectFileSource(scope);
    void PageConnection.open(scope, files).then(async page => {
        try {
            await startProjectWorld(scope, page, files, entry);
        } catch (error) {
            console.error(error);
            page.fail(error);
        }
    });
}
