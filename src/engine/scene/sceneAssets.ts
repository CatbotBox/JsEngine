import type {Resource} from "../core";
import type {ResourceCtor} from "../core/resource";
import {normalizePath} from "../platform/paths";
import type {FileSource} from "../platform/platform";
import type {MeshLoadOptions} from "../rendering/3d/mesh";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {parseDataAssetDocument} from "./dataAssetDocument";
import {isBuiltInAssetPath, PREFAB_ASSET_TYPE_NAME} from "./fieldSchema";
import type {FieldSchema, FieldType} from "./fieldSchema";
import {PrefabAsset} from "./prefabAsset";
import {isSceneJsonObject, parseSceneDocument} from "./sceneDocument";
import type {SceneDocument, SceneFieldValues, SceneJsonValue} from "./sceneDocument";

export type SceneAssetKind = string;

export type AssetPreload = (paths: readonly string[]) => Promise<void>;

export const LOAD_ON_DEMAND_FIELD_KEY = "loadOnDemand";

const BOOLEAN_FIELD_KIND = "boolean";
const LOADED_UP_FRONT = false;

export interface SceneAssetReference {
    readonly kind: SceneAssetKind;
    readonly path: string;
    readonly loadOnDemand?: boolean;
}

export interface SceneAssetLoader {
    readonly loadOptions: MeshLoadOptions;

    loadCached<A>(kind: SceneAssetKind, path: string, load: () => A): A;

    loadPrefab(path: string): PrefabAsset;

    isPrefabLoaded(path: string): boolean;

    reloadPrefab(path: string): boolean;

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
    const loadedPrefabsAt = (path: string): PrefabAsset[] => {
        const key = normalizePath(path);
        return [...prefabs].filter(([loadedPath]) => normalizePath(loadedPath) === key).map(([, prefab]) => prefab);
    };
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
                prefab = new PrefabAsset(path, parseSceneDocument(options.files.readText(path), path));
                prefabs.set(path, prefab);
            }
            return prefab;
        },
        isPrefabLoaded(path: string): boolean {
            return loadedPrefabsAt(path).length > 0;
        },
        reloadPrefab(path: string): boolean {
            const reloaded = loadedPrefabsAt(path);
            if (reloaded.length === 0) return false;
            const document = parseSceneDocument(options.files.readText(path), path);
            for (const prefab of reloaded) prefab.replaceDocument(document);
            return true;
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

function marksLoadOnDemand(fields: readonly FieldSchema[], values: SceneFieldValues): boolean {
    return values[LOAD_ON_DEMAND_FIELD_KEY] === true && fields.some(field => field.key === LOAD_ON_DEMAND_FIELD_KEY && field.kind === BOOLEAN_FIELD_KIND);
}

class AssetReferenceCollector {
    private readonly byKey = new Map<string, SceneAssetReference>();

    public get references(): SceneAssetReference[] {
        return [...this.byKey.values()];
    }

    public collectFields(fields: readonly FieldSchema[], values: SceneFieldValues, loadOnDemand: boolean = LOADED_UP_FRONT): void {
        const fieldsLoadOnDemand = loadOnDemand || marksLoadOnDemand(fields, values);
        for (const field of fields) this.collect(field, values[field.key], fieldsLoadOnDemand);
    }

    private collect(type: FieldType, json: SceneJsonValue | undefined, loadOnDemand: boolean): void {
        if (json === undefined || json === null) return;
        switch (type.kind) {
            case "asset":
                if (isSceneJsonObject(json) && typeof json.path === "string") this.add(type.assetType, json.path, loadOnDemand);
                return;
            case "list":
                if (Array.isArray(json)) for (const element of json) this.collect(type.element, element, loadOnDemand);
                return;
            case "struct":
                if (isSceneJsonObject(json)) this.collectFields(type.fields, json, loadOnDemand);
                return;
            default:
                return;
        }
    }

    private add(kind: SceneAssetKind, path: string, loadOnDemand: boolean): void {
        if (isBuiltInAssetPath(path)) return;
        const key = cacheKey(kind, path);
        const known = this.byKey.get(key);
        if (known !== undefined && (known.loadOnDemand !== true || loadOnDemand)) return;
        this.byKey.set(key, loadOnDemand ? {kind, path, loadOnDemand} : {kind, path});
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
        if (isPrefab) return sceneAssetPaths(parseSceneDocument(text, reference.path), registry);
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
    const expanded = new Set<string>();
    let pending = references;
    while (pending.length > 0) {
        const fresh: string[] = [];
        const expanding: SceneAssetReference[] = [];
        for (const reference of pending) {
            if (!preloaded.has(reference.path)) {
                preloaded.add(reference.path);
                fresh.push(reference.path);
            }
            if (reference.loadOnDemand === true || expanded.has(reference.path)) continue;
            expanded.add(reference.path);
            expanding.push(reference);
        }
        if (fresh.length > 0) await preload(fresh);
        pending = expanding.flatMap(reference => nestedAssetReferences(reference, registry, files));
    }
}
