import {SPRITE_IMAGE_ASSET_TYPE} from "../rendering/2d/spriteImageAssetType";
import {MESH_ASSET_TYPE} from "../rendering/3d/meshAssetType";
import {SHADER_ASSET_TYPE} from "../rendering/shaderAssetType";
import type {StructFieldType} from "./fieldSchema";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import {PREFAB_ASSET_TYPE} from "./prefabAssetType";
import type {SceneAssetLoader} from "./sceneAssets";
import type {SceneJsonObject} from "./sceneDocument";

export {MESH_ASSET_TYPE_NAME, PREFAB_ASSET_TYPE_NAME, PREFAB_FILE_SUFFIX, SHADER_ASSET_TYPE_NAME, SPRITE_IMAGE_ASSET_TYPE_NAME} from "./fieldSchema";
export {MESH_ASSET_TYPE, PREFAB_ASSET_TYPE, SHADER_ASSET_TYPE, SPRITE_IMAGE_ASSET_TYPE};

export interface InlineAssetCodec<A> {
    readonly expectation: string;

    editableStruct?(): StructFieldType;

    matches(json: SceneJsonObject): boolean;

    encode(value: A, context: FieldEncodeContext, path: string): SceneJsonObject;

    decode(json: SceneJsonObject, context: FieldDecodeContext, path: string): A;
}

export interface AssetType<A = unknown> {
    readonly name: string;
    readonly valueName: string;
    readonly fileSuffixes: readonly string[];
    readonly builtInPaths?: readonly string[];
    readonly inline?: InlineAssetCodec<A>;

    isAsset(value: unknown): value is A;

    load(path: string, loader: SceneAssetLoader): A;

    pathOf(value: A): string | undefined;
}

export const ENGINE_ASSET_TYPES: readonly AssetType[] = [
    MESH_ASSET_TYPE as AssetType,
    SPRITE_IMAGE_ASSET_TYPE as AssetType,
    PREFAB_ASSET_TYPE as AssetType,
    SHADER_ASSET_TYPE as AssetType,
];
