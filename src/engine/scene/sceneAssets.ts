import type {Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {FileSource} from "../platform/platform";
import type {MeshLoadOptions} from "../rendering/3d/mesh";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {parseDataAssetDocument} from "./dataAssetDocument";
import {PREFAB_ASSET_TYPE_NAME} from "./fieldSchema";
import type {FieldSchema, FieldType} from "./fieldSchema";
import {PrefabAsset} from "./prefabAsset";
import {isSceneJsonObject, parseSceneDocument} from "./sceneDocument";
import type {SceneDocument, SceneFieldValues, SceneJsonValue} from "./sceneDocument";

export type SceneAssetKind = string;

export type AssetPreload = (paths: readonly string[]) => Promise<void>;

export interface SceneAssetReference {
    readonly kind: SceneAssetKind;
    readonly path: string;
}

export interface SceneAssetLoader {
    readonly loadOptions: MeshLoadOptions;

    loadCached<A>(kind: SceneAssetKind, path: string, load: () => A): A;

    loadPrefab(path: string): PrefabAsset;

    loadText(path: string): string;

    loadDataAsset<R extends Resource>(path: string, type: ResourceCtor<R>): R;
}

export interface DataAssetSource {
    load<R extends Resource>(path: string, type?: ResourceCtor<R>): R;
}

function cacheKey(kind: SceneAssetKind, path: string): string {
    return `${kind}:${path}`;
}

export function platformSceneAssetLoader(options: MeshLoadOptions, dataAssets?: DataAssetSource): SceneAssetLoader {
    const loaded = new Map<string, unknown>();
    const prefabs = new Map<string, PrefabAsset>();
    return {
        loadOptions: options,
        loadCached<A>(kind: SceneAssetKind, path: string, load: () => A): A {
            const key = cacheKey(kind, path);
            if (loaded.has(key)) return loaded.get(key) as A;
            const asset = load();
            loaded.set(key, asset);
            return asset;
        },
        loadPrefab(path: string): PrefabAsset {
            let prefab = prefabs.get(path);
            if (prefab === undefined) {
                prefab = new PrefabAsset(path, parseSceneDocument(options.files.readText(path)));
                prefabs.set(path, prefab);
            }
            return prefab;
        },
        loadText(path: string): string {
            return options.files.readText(path);
        },
        loadDataAsset<R extends Resource>(path: string, type: ResourceCtor<R>): R {
            if (dataAssets === undefined) throw new Error(`Loading the data asset "${path}" needs a DataAssets resource; this asset loader has none`);
            return dataAssets.load(path, type);
        },
    };
}

class AssetReferenceCollector {
    public readonly references: SceneAssetReference[] = [];
    private readonly seen = new Set<string>();

    public collectFields(fields: readonly FieldSchema[], values: SceneFieldValues): void {
        for (const field of fields) this.collect(field, values[field.key]);
    }

    private collect(type: FieldType, json: SceneJsonValue | undefined): void {
        if (json === undefined || json === null) return;
        switch (type.kind) {
            case "asset":
                if (isSceneJsonObject(json) && typeof json.path === "string") this.add(type.assetType, json.path);
                return;
            case "list":
                if (Array.isArray(json)) for (const element of json) this.collect(type.element, element);
                return;
            case "struct":
                if (isSceneJsonObject(json)) this.collectFields(type.fields, json);
                return;
            default:
                return;
        }
    }

    private add(kind: SceneAssetKind, path: string): void {
        const key = cacheKey(kind, path);
        if (this.seen.has(key)) return;
        this.seen.add(key);
        this.references.push({kind, path});
    }
}

export function assetReferencesOfFields(fields: readonly FieldSchema[], values: SceneFieldValues): SceneAssetReference[] {
    const collector = new AssetReferenceCollector();
    collector.collectFields(fields, values);
    return collector.references;
}

export function sceneAssetPaths(document: SceneDocument, registry: ComponentSchemaRegistry): SceneAssetReference[] {
    const collector = new AssetReferenceCollector();
    for (const record of document.entities) {
        for (const componentName of Object.keys(record.components)) {
            const schema = registry.byName(componentName);
            if (schema !== undefined) collector.collectFields(schema.fields, record.components[componentName]);
        }
    }
    const resources = document.resources ?? {};
    for (const resourceName of Object.keys(resources)) {
        const schema = registry.resourceByName(resourceName);
        if (schema !== undefined) collector.collectFields(schema.fields, resources[resourceName]);
    }
    return collector.references;
}

function nestedAssetReferences(reference: SceneAssetReference, registry: ComponentSchemaRegistry, files: FileSource): SceneAssetReference[] {
    const isPrefab = reference.kind === PREFAB_ASSET_TYPE_NAME;
    const isDataAsset = registry.resourceByName(reference.kind) !== undefined;
    if (!isPrefab && !isDataAsset) return [];
    try {
        const text = files.readText(reference.path);
        if (isPrefab) return sceneAssetPaths(parseSceneDocument(text), registry);
        const document = parseDataAssetDocument(text, reference.path);
        const schema = registry.resourceByName(document.type);
        return schema === undefined ? [] : assetReferencesOfFields(schema.fields, document.fields);
    } catch {
        return [];
    }
}

export async function preloadAssetReferences(
    references: readonly SceneAssetReference[],
    registry: ComponentSchemaRegistry,
    files: FileSource,
    preload: AssetPreload,
): Promise<void> {
    const preloaded = new Set<string>();
    let pending = references;
    while (pending.length > 0) {
        const fresh: SceneAssetReference[] = [];
        for (const reference of pending) {
            if (preloaded.has(reference.path)) continue;
            preloaded.add(reference.path);
            fresh.push(reference);
        }
        if (fresh.length === 0) return;
        await preload(fresh.map(reference => reference.path));
        pending = fresh.flatMap(reference => nestedAssetReferences(reference, registry, files));
    }
}
