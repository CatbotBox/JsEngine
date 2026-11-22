import {registerImageDecoders} from "../assets/image/decodedImage";
import type {ImageDecoderEntry} from "../assets/image/decodedImage";
import {createSystems} from "../core";
import type {Resource, System, SystemCtor, World} from "../core";
import {directoryFileSource} from "../platform/directoryFileSource";
import type {ComponentSchemaRegistry} from "../scene/componentSchemaRegistry";
import {dataAssetsOf} from "../scene/dataAssets";
import type {ResourceSchema} from "../scene/fieldSchema";
import {SceneManager} from "../scene/sceneManager";
import type {SceneActivation, SceneHandle, SceneLoadMode, ScenePreload} from "../scene/sceneManager";
import type {SchemaChangePolicy} from "../scene/schemaChanges";
import type {SchemaEntry} from "../scene/schemaEntries";
import type {UnknownComponentTypePolicy} from "../scene/sceneSerialization";
import {AssetFiles} from "./assetFiles";
import type {ProjectAssetFiles} from "./assetFiles";
import type {ProjectResourceBinding} from "./projectManifest";
import {createProjectSchemaRegistry} from "./projectSchemas";

export interface GameHost {
    readonly directory?: string;
    readonly preload?: ScenePreload;
    readonly files?: ProjectAssetFiles;
    readonly unknownComponentTypes?: UnknownComponentTypePolicy;
    readonly schemaChanges?: SchemaChangePolicy;
    readonly hostSchemas?: readonly SchemaEntry[];
}

export interface GameOptions extends GameHost {
    readonly schemas?: readonly SchemaEntry[];
    readonly imageDecoders?: readonly ImageDecoderEntry[];
    readonly systems?: readonly SystemCtor<System>[];
    readonly resources?: readonly ProjectResourceBinding[];
    readonly startScene?: string;
    readonly startSceneActivation?: SceneActivation;
}

export interface ProjectHost extends GameHost {
    readonly backendSystems?: readonly SystemCtor<System>[];
}

export interface StartedGame {
    readonly registry: ComponentSchemaRegistry;
    readonly scenes: SceneManager;
    readonly startScene: SceneHandle | undefined;
}

export type StartProject = (world: World, host?: ProjectHost) => Promise<StartedGame>;

const START_SCENE_LOAD_MODE: SceneLoadMode = "single";
const DEFAULT_START_SCENE_ACTIVATION: SceneActivation = "onCommandBufferPlayback";
const NO_RESOURCES: readonly ProjectResourceBinding[] = [];
const NO_SYSTEMS: readonly SystemCtor<System>[] = [];
const NO_IMAGE_DECODERS: readonly ImageDecoderEntry[] = [];

function bindingLabel(index: number): string {
    return `resources[${index}]`;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function requireResourceSchema(registry: ComponentSchemaRegistry, binding: ProjectResourceBinding, index: number): ResourceSchema {
    const schema = registry.resourceByName(binding.type);
    if (schema === undefined) throw new Error(`${bindingLabel(index)}: the resource type "${binding.type}" for "${binding.path}" is not registered`);
    return schema;
}

async function loadResources(world: World, scenes: SceneManager, registry: ComponentSchemaRegistry, bindings: readonly ProjectResourceBinding[]): Promise<void> {
    if (bindings.length === 0) return;
    const schemas = bindings.map((binding, index) => requireResourceSchema(registry, binding, index));
    await scenes.preloadAssets(bindings.map(binding => ({kind: binding.type, path: binding.path})));
    const dataAssets = dataAssetsOf(world, registry);
    const loaded: Resource[] = bindings.map((binding, index) => {
        try {
            return dataAssets.load(binding.path, schemas[index].ctor);
        } catch (error) {
            throw new Error(`${bindingLabel(index)}: could not load the ${binding.type} data asset "${binding.path}": ${describeError(error)}`);
        }
    });
    for (const resource of loaded) world.resources.insert(resource);
}

export async function startGame(world: World, options: GameOptions): Promise<StartedGame> {
    registerImageDecoders(options.imageDecoders ?? NO_IMAGE_DECODERS);
    const registry = createProjectSchemaRegistry(options);
    const scenes = new SceneManager(world, registry, {
        files: options.directory === undefined ? undefined : directoryFileSource(world.platform.files, options.directory),
        preload: options.preload,
        unknownComponentTypes: options.unknownComponentTypes,
        schemaChanges: options.schemaChanges,
    });
    if (options.files !== undefined) world.resources.insert(new AssetFiles(options.files));
    await loadResources(world, scenes, registry, options.resources ?? NO_RESOURCES);
    createSystems(world, options.systems ?? NO_SYSTEMS);
    const startScene = options.startScene === undefined
        ? undefined
        : await scenes.load(options.startScene, {mode: START_SCENE_LOAD_MODE, activation: options.startSceneActivation ?? DEFAULT_START_SCENE_ACTIVATION});
    return {registry, scenes, startScene};
}
