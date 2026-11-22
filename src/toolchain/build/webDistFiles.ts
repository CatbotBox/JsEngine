import {PROJECT_MANIFEST_FILE, SCENE_FILE_SUFFIX} from "../../engine/project/projectManifest";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import {PREFAB_FILE_SUFFIX} from "../../engine/scene/fieldSchema";
import {WGSL_FILE_SUFFIX} from "../../engine/rendering/shaderSource";

export const EDITOR_PAGE = "editor.html";

const WEB_PROJECT_DATA_FILE_ENDINGS: readonly string[] = [PROJECT_MANIFEST_FILE, DATA_ASSET_FILE_SUFFIX, SCENE_FILE_SUFFIX, PREFAB_FILE_SUFFIX, WGSL_FILE_SUFFIX];

export function isWebProjectDataFile(path: string): boolean {
    const lower = path.toLowerCase();
    return WEB_PROJECT_DATA_FILE_ENDINGS.some(ending => lower.endsWith(ending));
}
