import type {Resource, World} from "../../engine/core";
import type {ComponentSchemaRegistry} from "../../engine/scene/componentSchemaRegistry";
import {dataAssetsOf} from "../../engine/scene/dataAssets";
import type {ResourceSchema} from "../../engine/scene/fieldSchema";
import type {SceneActivation, SceneHandle, SceneLoadMode} from "../../engine/scene/sceneManager";
import type {ProjectEntryModule, ProjectHost} from "./projectEntry";
import {PROJECT_MANIFEST_FILE} from "./projectManifest";
import type {ProjectManifest, ProjectResourceBinding} from "./projectManifest";

const START_SCENE_LOAD_MODE: SceneLoadMode = "single";
const START_SCENE_ACTIVATION: SceneActivation = "onCommandBufferPlayback";
const NO_RESOURCES: readonly ProjectResourceBinding[] = [];

function bindingLabel(index: number): string {
    return `${PROJECT_MANIFEST_FILE} resources[${index}]`;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function requireResourceSchema(registry: ComponentSchemaRegistry, binding: ProjectResourceBinding, index: number): ResourceSchema {
    const schema = registry.resourceByName(binding.type);
    if (schema === undefined) throw new Error(`${bindingLabel(index)}: the resource type "${binding.type}" for "${binding.path}" is not registered`);
    return schema;
}

export async function loadProjectResources(world: World, host: ProjectHost, manifest: ProjectManifest, registry: ComponentSchemaRegistry): Promise<Resource[]> {
    const bindings = manifest.resources ?? NO_RESOURCES;
    if (bindings.length === 0) return [];
    const schemas = bindings.map((binding, index) => requireResourceSchema(registry, binding, index));
    await host.scenes.preloadAssets(bindings.map(binding => ({kind: binding.type, path: binding.path})));
    const dataAssets = dataAssetsOf(world, registry);
    const loaded = bindings.map((binding, index) => {
        try {
            return dataAssets.load(binding.path, schemas[index].ctor);
        } catch (error) {
            throw new Error(`${bindingLabel(index)}: could not load the ${binding.type} data asset "${binding.path}": ${describeError(error)}`);
        }
    });
    for (const resource of loaded) world.resources.insert(resource);
    return loaded;
}

export async function startProject(
    world: World,
    entry: ProjectEntryModule,
    host: ProjectHost,
    manifest: ProjectManifest,
    registry: ComponentSchemaRegistry,
): Promise<SceneHandle | undefined> {
    await loadProjectResources(world, host, manifest, registry);
    await entry.setupProject(world, host);
    if (manifest.startScene === undefined) return undefined;
    return host.scenes.load(manifest.startScene, {mode: START_SCENE_LOAD_MODE, activation: START_SCENE_ACTIVATION});
}
