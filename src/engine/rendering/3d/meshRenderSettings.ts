import {Component} from "../../core";

const BACKEND_DEFAULT_SUPERSAMPLE = undefined;

export class MeshRenderSettings extends Component {
    public textures: boolean = true;
    public lod: boolean = true;
    public lodBias: number = 0;
    public supersampleX: number | undefined = BACKEND_DEFAULT_SUPERSAMPLE;
    public supersampleY: number | undefined = BACKEND_DEFAULT_SUPERSAMPLE;
}
