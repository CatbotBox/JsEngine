import {EntityCommandBuffer, System} from "../core";
import {Parent} from "./parent";
import {ComponentLookup} from "../core/entityArchetype";
import {EntityCommandBufferSystem} from "../core";
import {TranslationSystemGroup} from "./TranslationSystemGroup";
import {Children} from "./children";

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

        let buffer: EntityCommandBuffer | undefined = undefined;
        const world = this.world;

        function getBuffer() {
            if (buffer === undefined) {
                const commandBufferSystem = world.getOrCreateSystem(EntityCommandBufferSystem)
                buffer = commandBufferSystem.createEntityCommandBuffer()
            }
            return buffer;
        }

        // ensure children have this entity as parent
        this._parentQuery.stream({read: {children: Children}},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            // consume: one reused row instead of one per entity; `entity` is
            // read during the callback, never the row itself.
            .consume(({children, entity}) => {
                // Indexed loop, not forEach: see Children's class comment.
                const kids = children.children;
                for (let i = 0; i < kids.length; i++) {
                    const child = kids[i];
                    const component = this._childLookup.tryGetComponent(child)
                    if (component) {
                        if (component.entity !== entity) {
                            component.entity = entity;
                        }
                        continue;
                    }
                    getBuffer().addComponent(child, new Parent(entity));
                }
            })

        // ensure parents have this entity as children
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
                getBuffer().addComponent(parent.entity, new Children(entity));
            })
    }
}