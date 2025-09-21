import {System} from "../core";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {Parent} from "./parent";
import {ComponentLookup} from "../core/entityArchetype";

export class LocalToWorldSystem extends System {
    private _baseQuery = this.createEntityQuery([LocalPosition, LocalToWorld])
    private _parentQuery = this.createEntityQuery([Parent, LocalToWorld])
    private _noParentQuery = this.createEntityQuery([LocalPosition, LocalToWorld], [Parent])
    private _localToWorldLookup = new ComponentLookup(this, LocalToWorld)

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._baseQuery);
    }

    onUpdate() {
        this._baseQuery.stream({
            localRotation: LocalRotation,
            localToWorld: LocalToWorld,
            position: LocalPosition,
            localScale: LocalScale,
        }, {
            // filterLastUpdated: this.lastUpdateTime,
            // filterBlackList: [LocalToWorld],
        }).forEach(({localToWorld, position, localRotation, localScale}) => {
            const pos = position
            const rotation = localRotation ?? new LocalRotation();
            const scale = localScale ?? new LocalScale();

            localToWorld.setTRS(pos.xyz, rotation.xyzw, scale.xyz)
        });

        this._noParentQuery.stream({
            localRotation: LocalRotation,
            localToWorld: LocalToWorld,
            position: LocalPosition,
            localScale: LocalScale,
        }, {
            // can use caching since no parents
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [LocalToWorld],
        }).forEach(({localToWorld, position, localRotation, localScale}) => {
            const pos = position
            const rotation = localRotation ?? new LocalRotation();
            const scale = localScale ?? new LocalScale();

            localToWorld.setTRS(pos.xyz, rotation.xyzw, scale.xyz)
        });

        this._parentQuery.stream({
            localToWorld: LocalToWorld,
            parent: Parent
        }, {
            // filterLastUpdated: this.lastUpdateTime,
            // filterBlackList: [LocalToWorld],
        }).forEach(({localToWorld, parent}) => {
            const parentLocalToWorld = this._localToWorldLookup.tryGetComponent(parent.entity)
            if (parentLocalToWorld === undefined) {
                return;
            }
            localToWorld.mul(parentLocalToWorld);
        });
    }
}