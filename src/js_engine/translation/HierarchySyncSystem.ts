import {System} from "../core";
import {Children, Parent} from "./parent";
import {ComponentLookup} from "../core/entityArchetype";
import {EntityCommandBufferSystem} from "../core/entityCommandBufferSystem";
import {TranslationSystemGroup} from "./TranslationSystemGroup";

export class HierarchySyncSystem extends System {
    private _parentQuery = this.createEntityQuery([Children])
    private _childQuery = this.createEntityQuery([Parent])
    private _parentLookup = new ComponentLookup(this, Children, this._parentQuery)
    private _childLookup = new ComponentLookup(this, Parent, this._childQuery)

    override systemGroup() {
        return TranslationSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._parentQuery);
        this.requireAnyForUpdate(this._childQuery);
    }

    onUpdate() {
        const commandBufferSystem = this.world.getOrCreateSystem(EntityCommandBufferSystem)


        const buffer = commandBufferSystem.createEntityCommandBuffer()
        // ensure children have this entity as parent
        this._parentQuery.stream({children: Children},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            .forEach(({children, entity}) => {
                children.children.forEach((child) => {
                    const component = this._childLookup.tryGetComponent(child)
                    if (component) {
                        if (component.entity !== entity) {
                            component.entity = entity;
                        }
                        return;
                    }
                    buffer.addComponent(child, new Parent(entity));
                })
            })

        // ensure parents have this entity as children
        this._childQuery.stream({parent: Parent},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            .forEach(({parent, entity}) => {
                const component = this._parentLookup.tryGetComponent(parent.entity)
                if (component) {
                    if (!component.children.has(entity)) {
                        component.addChild(entity);
                    }
                    return;
                }
                buffer.addComponent(parent.entity, new Children(entity));
            })
    }
}