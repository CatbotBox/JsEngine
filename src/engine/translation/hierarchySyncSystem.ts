import {EntityCommandBuffer, System} from "../core";
import {Parent} from "./parent";
import {ComponentLookup} from "../core/entityArchetype";
import {EntityCommandBufferSystem} from "../core";
import {TranslationSystemGroup} from "./translationSystemGroup";
import {Children} from "./children";

const EARLY_TRANSLATION_PRIORITY = -10;

export class HierarchySyncSystem extends System {
    private _parentQuery = this.createEntityQuery([Children])
    private _childQuery = this.createEntityQuery([Parent])
    private _parentLookup = new ComponentLookup(this, Children)
    private _childLookup = new ComponentLookup(this, Parent)

    override systemGroup() {
        return TranslationSystemGroup;
    }

    override priority(): number {
        return EARLY_TRANSLATION_PRIORITY;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._parentQuery);
        this.requireAnyForUpdate(this._childQuery);
    }

    onUpdate() {

        let buffer: EntityCommandBuffer | undefined = undefined;
        const world = this.world;

        function requireCommandBuffer() {
            if (buffer === undefined) {
                const commandBufferSystem = world.getOrCreateSystem(EntityCommandBufferSystem)
                buffer = commandBufferSystem.getEntityCommandBuffer()
            }
            return buffer;
        }

        this._parentQuery.stream({read: {children: Children}},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            .consume(({children, entity}) => {
                const childEntities = children.children;
                for (let i = 0; i < childEntities.length; i++) {
                    const child = childEntities[i];
                    const component = this._childLookup.tryGetComponent(child)
                    if (component) {
                        if (component.entity !== entity) {
                            component.entity = entity;
                        }
                        continue;
                    }
                    requireCommandBuffer().addComponent(child, new Parent(entity));
                }
            })

        this._childQuery.stream({read: {parent: Parent}},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            .consume(({parent, entity}) => {
                const component = this._parentLookup.tryGetComponent(parent.entity)
                if (component) {
                    if (!component.has(entity)) {
                        component.addChild(entity);
                    }
                    return;
                }
                requireCommandBuffer().addComponent(parent.entity, new Children(entity));
            })
    }
}