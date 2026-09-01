import {Component, Entity} from "../core";
import type {F32Backed} from "../core/componentType";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {LocalToWorld} from "./localToWorld";
import {ReadonlyVec16} from "../math/types/vec";
import {Children} from "./children";

export class Parent extends Component {
    public constructor(public entity: Entity) {
        super();
    }

    public setup(entity: Entity, entityManager: EntityWriteOptions) {
        const parent = this.entity;
        entityManager.addComponent(entity, new ParentTransform())
        entityManager.addComponent(parent, new Children())
    }
}

export class ParentTransform extends Component implements F32Backed {
    /** SoA: delegates to the inner LocalToWorld's 16-float matrix. */
    static readonly f32Width = 16;

    private _transform: LocalToWorld = new LocalToWorld();

    public get transform() {
        return this._transform.matrix;
    }

    // Accepts ReadonlyVec16 because the setter copies rather than aliasing, so a
    // read-only matrix off a query row is a legitimate source.
    public set transform(transform: ReadonlyVec16) {
        this._transform.matrix = transform;
    }

    public constructor() {
        super();
    }

    // ---- F32Backed (store-driven; see core/componentType.ts) ----

    writeF32(dst: Float32Array, offset: number): void {
        this._transform.writeF32(dst, offset);
    }

    bindF32(src: Float32Array, offset: number): void {
        this._transform.bindF32(src, offset);
    }

    detachF32(): void {
        this._transform.detachF32();
    }
}