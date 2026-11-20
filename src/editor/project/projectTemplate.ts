import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import type {ProjectManifest} from "../../engine/project/projectManifest";

export const STARTER_SCENE_FILE = "scenes/main.scene.json";

const JSON_INDENT_SPACES = 2;

export interface ProjectFile {
    readonly path: string;
    readonly contents: string;
}

function emptySceneSource(): string {
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []}, null, JSON_INDENT_SPACES) + "\n";
}

export function createProjectFiles(name: string): readonly ProjectFile[] {
    if (name.trim().length === 0) throw new Error("A new project needs a non-empty name");
    const manifest: ProjectManifest = {name: name.trim(), startScene: STARTER_SCENE_FILE};
    return [
        {path: PROJECT_MANIFEST_FILE, contents: JSON.stringify(manifest, null, JSON_INDENT_SPACES) + "\n"},
        {path: STARTER_SCENE_FILE, contents: emptySceneSource()},
    ];
}
