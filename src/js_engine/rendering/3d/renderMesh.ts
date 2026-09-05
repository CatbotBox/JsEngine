import {Component, Entity} from "../../core";
import {EntityWriteOptions} from "../../core/entityWriteOptions";
import {Mesh} from "./mesh";
import {RenderBounds} from "../renderBounds";
import {FaceCulling} from "./faceCulling";

export class RenderMesh extends Component {
    /**
     * Which faces to skip by screen-space winding. BackFaces (default) hides
     * the far side of closed meshes; None draws both sides for meshes with
     * inconsistent winding or open shells; FrontFaces shows only the far side.
     * A drawn back face keeps its front-face lighting.
     */
    public faceCulling: FaceCulling = FaceCulling.BackFaces;

    public constructor(private _mesh?: Mesh, private _color: number = 0xFFFFFF) {
        super();
    }

    /**
     * RenderBounds (and, via its setup, WorldSpaceRenderBounds) is what lets
     * the 3D pass frustum-cull the mesh before touching its triangles;
     * RenderMeshBoundsSystem keeps it in sync with the mesh + transform.
     */
    public setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new RenderBounds());
    }

    get mesh(): Mesh | undefined {
        return this._mesh;
    }

    set mesh(value: Mesh | undefined) {
        this._mesh = value;
    }

    /** Packed 0xRRGGBB base color; shading (depth fade) is applied on top. */
    get color(): number {
        return this._color;
    }

    set color(value: number) {
        this._color = value & 0xFFFFFF;
    }
}
