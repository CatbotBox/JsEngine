import {QUERY_OR_FRAGMENT} from "../../hosts/desktop";
import {PROJECT_MANIFEST_FILE, SCENE_FILE_SUFFIX} from "../../engine/project/projectManifest";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import {PREFAB_FILE_SUFFIX} from "../../engine/scene/fieldSchema";
import {WGSL_FILE_SUFFIX} from "../../engine/rendering/shaderSource";

export const EDITOR_PAGE = "editor.html";

const WEB_PROJECT_DATA_FILE_ENDINGS: readonly string[] = [PROJECT_MANIFEST_FILE, DATA_ASSET_FILE_SUFFIX, SCENE_FILE_SUFFIX, PREFAB_FILE_SUFFIX, WGSL_FILE_SUFFIX];
const EDITOR_SITE_FILE_PREFIX = "editor";
const SITE_PATH_SEPARATOR = /[\\/]/;

export function isWebProjectDataFile(path: string): boolean {
    const lower = path.toLowerCase();
    return WEB_PROJECT_DATA_FILE_ENDINGS.some(ending => lower.endsWith(ending));
}

export function isEditorSiteFile(sitePath: string): boolean {
    const [pathOnly] = sitePath.split(QUERY_OR_FRAGMENT, 1);
    const parts = pathOnly.split(SITE_PATH_SEPARATOR).filter(part => part.length > 0);
    return parts.length === 1 && parts[0].startsWith(EDITOR_SITE_FILE_PREFIX);
}
