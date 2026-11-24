import type {SceneDocument} from "./sceneDocument";

export class PrefabAsset {
    private _document: SceneDocument;

    public constructor(public readonly sourcePath: string, document: SceneDocument) {
        this._document = document;
    }

    public get document(): SceneDocument {
        return this._document;
    }

    public replaceDocument(document: SceneDocument): void {
        this._document = document;
    }
}
