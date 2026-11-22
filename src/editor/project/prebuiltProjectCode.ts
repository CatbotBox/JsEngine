import type {ProjectManifest} from "../../engine/project/projectManifest";
import type {GameTarget} from "./editorSettings";
import type {ProjectFileSystem} from "./projectFileSystem";
import {PROJECT_EDITOR_EXTENSIONS_COPY_PATH, projectBuildCopyPath} from "./projectServerApi";

export type ProjectFileReader = Pick<ProjectFileSystem, "read">;

export interface PrebuiltProjectCode {
    readonly workerPath: string;
    readonly worker: Uint8Array | undefined;
    readonly editorExtensions: Uint8Array | undefined;
    readonly warnings: readonly string[];
}

const NO_WARNINGS: readonly string[] = [];

async function readOrUndefined(files: ProjectFileReader, path: string): Promise<Uint8Array | undefined> {
    try {
        return await files.read(path);
    } catch {
        return undefined;
    }
}

export function missingEditorExtensionsWarning(module: string): string {
    return `The editor extensions ${module} are not bundled (no ${PROJECT_EDITOR_EXTENSIONS_COPY_PATH}), so the editor runs without them. Open the project once with the dev server (jsengine edit) or the desktop editor (jsengine edit --target window) to bundle them.`;
}

export async function readPrebuiltProjectCode(files: ProjectFileReader, manifest: ProjectManifest, gameTarget: GameTarget): Promise<PrebuiltProjectCode> {
    const workerPath = projectBuildCopyPath(gameTarget);
    const extensionsModule = manifest.editorExtensions;
    const [worker, editorExtensions] = await Promise.all([
        readOrUndefined(files, workerPath),
        extensionsModule === undefined ? undefined : readOrUndefined(files, PROJECT_EDITOR_EXTENSIONS_COPY_PATH),
    ]);
    const missingExtensions = extensionsModule !== undefined && editorExtensions === undefined;
    return {workerPath, worker, editorExtensions, warnings: missingExtensions ? [missingEditorExtensionsWarning(extensionsModule)] : NO_WARNINGS};
}
