import {Component, Entity} from "../../core";
import {EntityWriteOptions} from "../../core/entityWriteOptions";
import {Mesh} from "./mesh";
import {RenderBounds} from "../renderBounds";
import {FaceCulling} from "./faceCulling";

const WHITE = 0xFFFFFF;
const PACKED_RGB_MASK = 0xFFFFFF;

export class RenderMesh extends Component {
    public faceCulling: FaceCulling = FaceCulling.BackFaces;

    public constructor(private _mesh?: Mesh, private _color: number = WHITE) {
        super();
    }

    public setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new RenderBounds());
    }

    get mesh(): Mesh | undefined {
        return this._mesh;
    }

    set mesh(value: Mesh | undefined) {
        this._mesh = value;
    }

    get color(): number {
        return this._color;
    }

    set color(value: number) {
        this._color = value & PACKED_RGB_MASK;
    }
}
