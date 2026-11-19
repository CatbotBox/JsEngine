import {Component} from "../../core";

export class MeshRenderSettings extends Component {
    public textures: boolean = true;
    public lod: boolean = true;
    public lodBias: number = 0;
}
