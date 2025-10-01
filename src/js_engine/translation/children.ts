import {Component, Entity} from "../core";

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