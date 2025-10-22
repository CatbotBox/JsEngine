import {Component} from "../../core";
import {Mesh} from "./mesh";

export class RenderMesh extends Component {
    public constructor(private _mesh?: Mesh) {
        super();
    }

    get mesh(): Mesh | undefined {
        return this._mesh;
    }

    set mesh(value: Mesh | undefined) {
        this._mesh = value;
    }
}