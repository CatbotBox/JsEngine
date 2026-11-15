import type {DebugWorld, World} from "../../src/engine/core";
import {meshCachePathFor, Mesh} from "../../src/engine/rendering/3d";
import type {ComponentSchemaRegistry} from "../../src/engine/scene";
import type {ProjectAssetFiles, ProjectHost, ProjectRenderBackend} from "../../src/editor/project/projectEntry";
import {requireDebugWorld} from "../_shared/debugWorld";
import {setupDemo3d} from "./game";
import type {Demo3dRenderControls, DemoModel, DemoModelFiles} from "./game";
import {DEFAULT_LAZY_MODEL_BYTES, demoModelsAmong} from "./projectModels";
import {installPixelRendering3d} from "./launch/pixelRendering";
import {installGpuRendering3d} from "./launch/gpuRendering";

const GPU_BACKEND: ProjectRenderBackend = "gpu";

function installRendering(world: DebugWorld, host: ProjectHost): Demo3dRenderControls {
    return host.renderBackend === GPU_BACKEND ? installGpuRendering3d(world) : installPixelRendering3d(world);
}

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
}

function projectModels(files: ProjectAssetFiles): DemoModel[] {
    return demoModelsAmong(files.list().map(file => file.path));
}

function fetchedBytesOf(model: DemoModel, files: ProjectAssetFiles): number {
    const sizes = new Map(files.list().map(file => [file.path, file.size]));
    return sizes.get(meshCachePathFor(model.path)) ?? sizes.get(model.path) ?? 0;
}

export async function setupProject(world: World, host: ProjectHost): Promise<void> {
    const debugWorld = requireDebugWorld(world, "The 3D demo");
    const platform = world.platform;
    const files = host.files;
    const loaded = new Set<string>();
    const load = async (model: DemoModel, onProgress?: (loadedBytes: number, totalBytes: number) => void): Promise<void> => {
        await files.loadFetchingAsNeeded(
            () => Mesh.fromFile(model.path, {files: platform.files, inflate: platform.inflate}),
            progress => onProgress?.(progress.loadedBytes, progress.totalBytes),
        );
        loaded.add(model.path);
    };
    for (const model of projectModels(files)) {
        if (fetchedBytesOf(model, files) <= DEFAULT_LAZY_MODEL_BYTES) await load(model);
    }
    const modelFiles: DemoModelFiles = {
        ready: model => loaded.has(model.path),
        fetch: (model, onProgress) => load(model, onProgress),
    };
    setupDemo3d(debugWorld, {
        render: installRendering(debugWorld, host),
        listModels: () => projectModels(files),
        modelFiles,
        quit: () => host.quit(),
    });
}
