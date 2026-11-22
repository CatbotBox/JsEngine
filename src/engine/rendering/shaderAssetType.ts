import type {AssetType} from "../scene/assetTypes";
import {SHADER_ASSET_TYPE_NAME} from "../scene/fieldSchema";
import {ShaderSource, WGSL_FILE_SUFFIX} from "./shaderSource";

const SHADER_FILE_SUFFIXES: readonly string[] = [WGSL_FILE_SUFFIX];

export const SHADER_ASSET_TYPE: AssetType<ShaderSource> = {
    name: SHADER_ASSET_TYPE_NAME,
    valueName: "ShaderSource",
    fileSuffixes: SHADER_FILE_SUFFIXES,
    isAsset: (value): value is ShaderSource => value instanceof ShaderSource,
    load: (path, loader) => new ShaderSource(path, loader.loadText(path)),
    pathOf: shader => shader.sourcePath,
};
