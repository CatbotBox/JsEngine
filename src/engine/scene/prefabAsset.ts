import type {SceneDocument} from "./sceneDocument";

export class PrefabAsset {
    public constructor(public readonly sourcePath: string, public readonly document: SceneDocument) {
    }
}
