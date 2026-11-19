import type {World} from "../../src/engine/core";
import {PrefabSpawner} from "../../src/engine/scene";
import type {ComponentSchemaRegistry, PrefabAsset} from "../../src/engine/scene";
import type {ProjectHost} from "../../src/engine/project/projectEntry";
import {setupDemo3d} from "./game";
import type {Demo3dModelFiles} from "./game";
import type {ModelLoadProgressListener} from "./modelCatalog";
import {requireModelPrefab} from "./modelCatalog";
import {registerGeneratedSchemas} from "./schemas.generated";
import {Demo3dTuning} from "./tuning";
import {Demo3dCellsControlsSystem} from "./backend/cells/demo3dCellsControlsSystem";
import {Demo3dPixelsControlsSystem} from "./backend/pixels/demo3dPixelsControlsSystem";
import {DemoSurfaceShaderSystem} from "./backend/gpu/gpuSurfaceShaders";
import {Demo3dGpuControlsSystem} from "./backend/gpu/demo3dGpuControlsSystem";

function ignoreProgress(): void {
}

function createBackendSystems(world: World): void {
    world.ensureSystemExists(Demo3dCellsControlsSystem);
    world.ensureSystemExists(Demo3dPixelsControlsSystem);
    world.ensureSystemExists(DemoSurfaceShaderSystem);
    world.ensureSystemExists(Demo3dGpuControlsSystem);
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
    createBackendSystems(world);
    setupDemo3d(world, {modelFiles});
}
