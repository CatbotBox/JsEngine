import {Component, Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {LocalToWorld} from "./localToWorld";

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

export class Children extends Component {
    private readonly _children: Set<Entity>;

    public get children() {
        return this._children;
    }

    public constructor(...childEntities: Entity[]) {
        super();
        this._children = new Set(childEntities);
    }

    public addChild(entity: Entity): void {
        this._children.add(entity);
        this.setDirty();

    }

    public removeChild(entity: Entity): void {
        this._children.delete(entity);
        this.setDirty();
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