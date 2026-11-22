import type {AssetType} from "./assetTypes";
import {PREFAB_ASSET_TYPE_NAME, PREFAB_FILE_SUFFIX} from "./fieldSchema";
import {PrefabAsset} from "./prefabAsset";

const PREFAB_FILE_SUFFIXES: readonly string[] = [PREFAB_FILE_SUFFIX];

export const PREFAB_ASSET_TYPE: AssetType<PrefabAsset> = {
    name: PREFAB_ASSET_TYPE_NAME,
    valueName: "PrefabAsset",
    fileSuffixes: PREFAB_FILE_SUFFIXES,
    isAsset: (value): value is PrefabAsset => value instanceof PrefabAsset,
    load: (path, loader) => loader.loadPrefab(path),
    pathOf: prefab => prefab.sourcePath,
};
