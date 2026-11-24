import {Resource} from "../core";
import type {SceneHandle, SceneLoadRequest, SceneManager} from "./sceneManager";

export class SceneLoader extends Resource {
    public constructor(private readonly scenes: SceneManager) {
        super();
        if (scenes === undefined) throw new Error("SceneLoader comes from a SceneManager, which inserts it into its world; it cannot be created on its own");
    }

    public load(path: string, request?: SceneLoadRequest): Promise<SceneHandle> {
        return this.scenes.load(path, request);
    }

    public active(): SceneHandle | undefined {
        return this.scenes.active();
    }
}
