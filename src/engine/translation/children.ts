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

    public indexOf(entity: Entity): number {
        return this._children.indexOf(entity);
    }

    public insertChild(entity: Entity, index: number): void {
        const current = this._children.indexOf(entity);
        const children = current < 0 ? this._children : this._children.filter(child => child !== entity);
        const clamped = Math.max(0, Math.min(Math.trunc(index), children.length));
        if (current === clamped) return;
        children.splice(clamped, 0, entity);
        if (children !== this._children) {
            this._children.length = 0;
            this._children.push(...children);
        }
        this.notifyChanged();
    }

    public moveChild(entity: Entity, index: number): void {
        if (this._children.indexOf(entity) < 0) throw new Error(`Children.moveChild: entity ${entity} is not a child here`);
        this.insertChild(entity, index);
    }

    public removeChildKeepingOrder(entity: Entity): void {
        const index = this._children.indexOf(entity);
        if (index < 0) return;
        this._children.splice(index, 1);
        this.notifyChanged();
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
