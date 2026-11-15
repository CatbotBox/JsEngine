import {DebugWorld} from "../../engine/core";
import {Input} from "../../engine/input";
import type {Platform} from "../../engine/platform/platform";
import {Mesh} from "../../engine/rendering/3d/mesh";
import {ComponentSchemaRegistry, registerEngineComponentSchemas} from "../../engine/scene";
import {registerCellsComponentSchemas} from "../../backends/cells/cellsComponentSchemas";
import {registerPixelsComponentSchemas} from "../../backends/pixels/pixelsComponentSchemas";
import {PixelPresenterResource} from "../../backends/pixels/pixelPresenterResource";
import {PageConnection} from "../../hosts/web/worldWorkerPlatform";
import type {WorldWorkerScope} from "../../hosts/web/worldWorkerPlatform";
import {attachEditorWorldService} from "../world/editorWorldService";
import type {EditorServiceScope} from "../world/editorWorldService";
import {ProjectFileSource} from "../project/projectFileSource";
import type {ProjectFilesChannel} from "../project/projectFileSource";
import type {ProjectAssetFile, ProjectAssetFiles, ProjectEntryModule, ProjectLoadProgress, ProjectLoadProgressListener} from "../project/projectEntry";

type ProjectEditorWorkerScope = WorldWorkerScope & EditorServiceScope & ProjectFilesChannel;

const MESH_EXTENSION = ".obj";
const BYTES_PER_MB = 1024 * 1024;
const MB_DECIMALS = 1;

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

async function startProjectWorld(scope: ProjectEditorWorkerScope, page: PageConnection, files: ProjectFileSource, entry: ProjectEntryModule): Promise<void> {
    const registry = projectComponentSchemas(entry);
    await files.whenListed();
    const world = new DebugWorld({platform: page.platform});
    world.resources.insert(new PixelPresenterResource(page.pixelPresenter()));
    page.connectInput(world.resources.getOrCreate(Input));
    const assetFiles = new SetupStatusAssetFiles(files, page);
    await entry.setupProject(world, {files: assetFiles, quit: () => page.quit()});
    assetFiles.stopReporting();
    attachEditorWorldService(scope, world, registry, {
        preloadAssets: paths => preloadProjectAssets(files, world.platform, paths),
    });
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
