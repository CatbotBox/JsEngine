import type {World} from "@jsengine/engine/core";
import {AssetFiles} from "@jsengine/engine/project";
import {PARENT_COMPONENT_NAME} from "@jsengine/engine/scene";
import type {PrefabAsset, PrefabSpawner, PrefabTemplate} from "@jsengine/engine/scene";
import type {ModelEntry} from "./tuning";

export const DEMO_3D_TUNING_FILE = "assets/demo3d.asset.json";

export type ModelLoadProgressListener = (loadedBytes: number, totalBytes: number) => void;

export interface Demo3dModelFiles {
    ready(prefab: PrefabAsset): boolean;
    fetch(prefab: PrefabAsset, onProgress: ModelLoadProgressListener): Promise<void>;
}

export interface ModelDownload {
    loadedBytes: number;
    totalBytes: number;
    queuedSpawns: number;
    failure?: string;
}

export type ModelLoadedListener = (model: CatalogModel, queuedSpawns: number) => void;

export function assetModelFiles(world: World, spawner: PrefabSpawner): Demo3dModelFiles | undefined {
    const files = world.resources.tryGet(AssetFiles)?.files;
    if (files === undefined) return undefined;
    const loaded = new Set<string>();
    return {
        ready: prefab => loaded.has(prefab.sourcePath),
        fetch: async (prefab, onProgress) => {
            await files.loadFetchingAsNeeded(() => spawner.templateOf(prefab), progress => onProgress(progress.loadedBytes, progress.totalBytes));
            loaded.add(prefab.sourcePath);
        },
    };
}

export function prefabRootName(prefab: PrefabAsset): string {
    const root = prefab.document.entities.find(record => record.components[PARENT_COMPONENT_NAME] === undefined);
    return root?.name ?? prefab.sourcePath;
}

export function requireModelPrefab(entry: ModelEntry, index: number): PrefabAsset {
    if (entry.prefab === undefined) throw new Error(`Demo3dTuning.models[${index}].prefab names no prefab: set it in ${DEMO_3D_TUNING_FILE}`);
    return entry.prefab;
}

export class CatalogModel {
    public template: PrefabTemplate | undefined = undefined;

    public constructor(public readonly prefab: PrefabAsset, public readonly name: string, public readonly loadOnDemand: boolean) {
    }
}

export class ModelCatalog {
    private _models: CatalogModel[] = [];
    private readonly _downloads = new Map<string, ModelDownload>();

    public constructor(private readonly spawner: PrefabSpawner, private readonly files: Demo3dModelFiles | undefined) {
    }

    public get models(): readonly CatalogModel[] {
        return this._models;
    }

    public get downloads(): ReadonlyMap<string, ModelDownload> {
        return this._downloads;
    }

    public refresh(entries: readonly ModelEntry[]): void {
        this._models = entries.map((entry, index) => {
            const prefab = requireModelPrefab(entry, index);
            const model = new CatalogModel(prefab, prefabRootName(prefab), entry.loadOnDemand);
            if (this.isReady(prefab)) model.template = this.spawner.templateOf(prefab);
            return model;
        });
    }

    public modelFrom(prefabPath: string): CatalogModel | undefined {
        return this._models.find(model => model.prefab.sourcePath === prefabPath);
    }

    public downloadModelsLoadedUpFront(onLoaded: ModelLoadedListener): void {
        for (const model of this._models) if (!model.loadOnDemand) this.downloadUnlessLoaded(model, onLoaded);
    }

    public downloadUnlessLoaded(model: CatalogModel, onLoaded: ModelLoadedListener): ModelDownload | undefined {
        const files = this.files;
        if (model.template !== undefined || files === undefined) return undefined;
        const path = model.prefab.sourcePath;
        const running = this._downloads.get(path);
        if (running !== undefined && running.failure === undefined) return running;
        const started: ModelDownload = {loadedBytes: 0, totalBytes: 0, queuedSpawns: 0};
        this._downloads.set(path, started);
        files.fetch(model.prefab, (loadedBytes, totalBytes) => {
            started.loadedBytes = loadedBytes;
            started.totalBytes = totalBytes;
        }).then(() => {
            const current = this.modelFrom(path);
            if (current !== undefined) {
                current.template ??= this.spawner.templateOf(current.prefab);
                onLoaded(current, started.queuedSpawns);
            }
            this._downloads.delete(path);
        }).catch(error => {
            started.failure = error instanceof Error ? error.message : String(error);
            console.error(`Could not load ${model.name}:`, error);
        });
        return started;
    }

    private isReady(prefab: PrefabAsset): boolean {
        return this.files?.ready(prefab) ?? true;
    }
}
