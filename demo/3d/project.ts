import type {World} from "../../src/engine/core";
import {PrefabSpawner} from "../../src/engine/scene";
import type {ComponentSchemaRegistry, PrefabAsset} from "../../src/engine/scene";
import type {ProjectHost, ProjectRenderBackend} from "../../src/engine/project/projectEntry";
import {setupDemo3d} from "./game";
import type {Demo3dModelFiles, Demo3dRenderControls} from "./game";
import type {ModelLoadProgressListener} from "./modelCatalog";
import {requireModelPrefab} from "./modelCatalog";
import {registerGeneratedSchemas} from "./schemas.generated";
import {Demo3dTuning} from "./tuning";
import {installPixelRendering3d} from "./launch/pixelRendering";
import {installGpuRendering3d} from "./launch/gpuRendering";

const GPU_BACKEND: ProjectRenderBackend = "gpu";

function ignoreProgress(): void {
}

function installRendering(world: World, host: ProjectHost): Demo3dRenderControls {
    return host.renderBackend === GPU_BACKEND ? installGpuRendering3d(world) : installPixelRendering3d(world);
}

function projectModelFiles(world: World, host: ProjectHost): Demo3dModelFiles {
    const spawner = world.resources.get(PrefabSpawner);
    const loaded = new Set<PrefabAsset>();
    return {
        ready: prefab => loaded.has(prefab),
        fetch: async (prefab: PrefabAsset, onProgress: ModelLoadProgressListener) => {
            await host.files.loadFetchingAsNeeded(() => spawner.templateOf(prefab), progress => onProgress(progress.loadedBytes, progress.totalBytes));
            loaded.add(prefab);
        },
    };
}

export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {
    registerGeneratedSchemas(registry);
}

export async function setupProject(world: World, host: ProjectHost): Promise<void> {
    const modelFiles = projectModelFiles(world, host);
    const models = world.resources.get(Demo3dTuning).models;
    for (const [index, entry] of models.entries()) {
        if (!entry.loadOnDemand) await modelFiles.fetch(requireModelPrefab(entry, index), ignoreProgress);
    }
    setupDemo3d(world, {
        render: installRendering(world, host),
        modelFiles,
        quit: () => host.quit(),
    });
}
