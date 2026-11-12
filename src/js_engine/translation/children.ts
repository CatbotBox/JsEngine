import {Component, Entity} from "../core";

export class Children extends Component {
    private readonly _children: Entity[] = [];

    public get children(): readonly Entity[] {
        return this._children;
    }

    public constructor(...childEntities: Entity[]) {
        super();
        for (const child of childEntities) this.addChild(child);
    }

    public has(entity: Entity): boolean {
        return this._children.indexOf(entity) >= 0;
    }

    public addChild(entity: Entity): void {
        if (this._children.indexOf(entity) >= 0) return;
        this._children.push(entity);
        this.notifyChanged();
    }

    public removeChild(entity: Entity): void {
        const index = this._children.indexOf(entity);
        if (index < 0) return;
        const lastIndex = this._children.length - 1;
        this._children[index] = this._children[lastIndex];
        this._children.length = lastIndex;
        this.notifyChanged();
    }
}
