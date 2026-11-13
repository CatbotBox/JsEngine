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
    static readonly f32Width = LocalToWorld.f32Width;

    private _transform: LocalToWorld = new LocalToWorld();

    public get transform() {
        return this._transform.matrix;
    }

    public set transform(transform: ReadonlyVec16) {
        this._transform.matrix = transform;
    }

    public constructor() {
        super();
    }

    writeF32(dst: Float32Array, offset: number): void {
        this._transform.writeF32(dst, offset);
    }

    bindF32(rowView: Float32Array): void {
        this._transform.bindF32(rowView);
    }

    detachF32(): void {
        this._transform.detachF32();
    }
}