import {joinPath} from "../../engine/platform/paths";
import type {AssetPreload} from "../../engine/scene/sceneAssets";
import type {PreloadedFileSource} from "./preloadedFileSource";

export function projectFilePreload(files: PreloadedFileSource, directory: string): AssetPreload {
    return async paths => {
        const sitePaths = paths.map(path => joinPath(directory, path));
        await files.preload(sitePaths.filter(path => !files.exists(path)));
        await files.ensureLoaded(sitePaths.filter(path => files.isPending(path)));
    };
}
