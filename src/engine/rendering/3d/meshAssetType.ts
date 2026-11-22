import type {AssetType} from "../../scene/assetTypes";
import {MESH_ASSET_TYPE_NAME} from "../../scene/fieldSchema";
import {Mesh} from "./mesh";

const MESH_FILE_SUFFIXES: readonly string[] = [".obj"];

export const MESH_ASSET_TYPE: AssetType<Mesh> = {
    name: MESH_ASSET_TYPE_NAME,
    valueName: "Mesh",
    fileSuffixes: MESH_FILE_SUFFIXES,
    isAsset: (value): value is Mesh => value instanceof Mesh,
    load: (path, loader) => loader.loadCached(MESH_ASSET_TYPE_NAME, path, () => Mesh.fromFile(path, loader.loadOptions)),
    pathOf: mesh => mesh.sourcePath,
};
