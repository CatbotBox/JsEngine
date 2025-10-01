import {Component, Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {LocalToWorld} from "./localToWorld";
import {Children} from "./children";

export class Parent extends Component {
    public constructor(public entity: Entity) {
        super();
    }

    public setup(entity: Entity, entityManager: EntityWriteOptions) {
        const parent = this.entity;
        const self = entity;
        entityManager.addComponent(self, new ParentTransform())
        entityManager.addComponent(parent, new Children())
    }
}

export class ParentTransform extends Component {
    private _transform: LocalToWorld = new LocalToWorld();

    public get transform() {
        return this._transform.matrix;
    }

    public set transform(transform) {
        this._transform.matrix = transform;
    }

    public constructor() {
        super();
    }
}