import {Entity, EntityCommandBuffer, System, Unchanged} from "../core";
import {Parent, ParentTransform} from "./parent";
import {ComponentLookup} from "../core/entityArchetype";
import {EntityCommandBufferSystem} from "../core";
import {TranslationSystemGroup} from "./translationSystemGroup";
import {Children} from "./children";
import {LocalPosition} from "./localPosition";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {LocalToWorld} from "./localToWorld";
import {ReadonlyVec3, ReadonlyVec4, Vec, Vec3, Vec4} from "../math/types/vec";

const EARLY_TRANSLATION_PRIORITY = -10;
const READ_ONLY = true;
const IDENTITY_ROTATION: ReadonlyVec4 = Vec.alloc4(0, 0, 0, 1);
const UNIT_SCALE: ReadonlyVec3 = Vec.alloc3(1, 1, 1);

export class HierarchySyncSystem extends System {
    private _parentQuery = this.createEntityQuery([Children])
    private _childQuery = this.createEntityQuery([Parent])
    private _parentLookup = new ComponentLookup(this, Children)
    private _childLookup = new ComponentLookup(this, Parent)
    private _parentTransformLookup = new ComponentLookup(this, ParentTransform)
    private _positionLookup = new ComponentLookup(this, LocalPosition)
    private _rotationLookup = new ComponentLookup(this, LocalRotation)
    private _scaleLookup = new ComponentLookup(this, LocalScale)
    private _orphanWorldTransform = new LocalToWorld()
    private _orphanWorldRotation: Vec4 = Vec4.alloc()
    private _orphanWorldScale: Vec3 = Vec3.alloc()

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
        const entityManager = this.entityManager;

        function requireCommandBuffer() {
            if (buffer === undefined) {
                const commandBufferSystem = world.getOrCreateSystem(EntityCommandBufferSystem)
                buffer = commandBufferSystem.getEntityCommandBuffer()
            }
            return buffer;
        }

        this._parentQuery.stream({write: {children: Children}},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            .consume(({children, entity}) => {
                const childEntities = children.children;
                let prunedDestroyedChild = false;
                for (let i = childEntities.length - 1; i >= 0; i--) {
                    const child = childEntities[i];
                    if (!entityManager.exists(child)) {
                        children.removeChild(child);
                        prunedDestroyedChild = true;
                        continue;
                    }
                    const component = this._childLookup.tryGetComponent(child)
                    if (component) {
                        if (component.entity !== entity) {
                            component.entity = entity;
                        }
                        continue;
                    }
                    requireCommandBuffer().addComponent(child, new Parent(entity));
                }
                return prunedDestroyedChild ? undefined : Unchanged;
            })

        this._childQuery.stream({read: {parent: Parent}},
            {
                includeEntity: true,
                filterLastUpdated: this.lastUpdateTime,
            })
            .consume(({parent, entity}) => {
                if (!entityManager.exists(parent.entity)) {
                    this.detachAsRoot(entity, requireCommandBuffer());
                    return;
                }
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

    private detachAsRoot(child: Entity, buffer: EntityCommandBuffer): void {
        buffer.removeComponent(child, Parent);
        buffer.removeComponent(child, ParentTransform);
        const parentTransform = this._parentTransformLookup.tryGetComponent(child, READ_ONLY);
        const position = this._positionLookup.tryGetComponent(child, READ_ONLY);
        if (parentTransform === undefined || position === undefined) return;
        const rotation = this._rotationLookup.tryGetComponent(child, READ_ONLY);
        const scale = this._scaleLookup.tryGetComponent(child, READ_ONLY);

        const worldTransform = this._orphanWorldTransform;
        LocalToWorld.fromTRS(worldTransform.matrix, position.xyz, rotation?.xyzw ?? IDENTITY_ROTATION, scale?.xyz ?? UNIT_SCALE);
        LocalToWorld.mul(parentTransform.transform, worldTransform.matrix, worldTransform.matrix);

        const worldPosition = new LocalPosition();
        worldPosition.xyz = worldTransform.position;
        buffer.setComponent(child, worldPosition);

        const worldRotation = worldTransform.rotationInto(this._orphanWorldRotation);
        if (rotation !== undefined || !Vec.equals(worldRotation, IDENTITY_ROTATION)) {
            const localRotation = new LocalRotation();
            localRotation.xyzw = worldRotation;
            buffer.setComponent(child, localRotation);
        }

        const worldScale = worldTransform.decomposeScaleInto(this._orphanWorldScale);
        if (scale !== undefined || !Vec.equals(worldScale, UNIT_SCALE)) {
            const localScale = new LocalScale();
            localScale.xyz = worldScale;
            buffer.setComponent(child, localScale);
        }
    }
}
