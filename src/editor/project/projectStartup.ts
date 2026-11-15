import type {World} from "../../engine/core";
import type {SceneHandle, SceneLoadMode} from "../../engine/scene/sceneManager";
import type {ProjectEntryModule, ProjectHost} from "./projectEntry";
import type {ProjectManifest} from "./projectManifest";

const START_SCENE_LOAD_MODE: SceneLoadMode = "single";

export async function startProject(world: World, entry: ProjectEntryModule, host: ProjectHost, manifest: ProjectManifest): Promise<SceneHandle | undefined> {
    await entry.setupProject(world, host);
    if (manifest.startScene === undefined) return undefined;
    return host.scenes.load(manifest.startScene, {mode: START_SCENE_LOAD_MODE});
}
