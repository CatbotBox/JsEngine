import {System} from "../core";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {Parent} from "./parent";

export class LocalToWorldSystem extends System {
    private _query = this.createEntityQuery([LocalPosition, LocalToWorld])


    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate() {
        this._query.stream({
            localRotation: LocalRotation,
            localToWorld: LocalToWorld,
            position: LocalPosition,
            localScale: LocalScale,
            parent: Parent
        }, {
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [LocalToWorld],
        }).forEach(({localToWorld, position, localRotation, localScale, parent}) => {
            const pos = position
            const rotation = localRotation ?? new LocalRotation();
            const scale = localScale ?? new LocalScale();

            localToWorld.setTRS(pos.xyz, rotation.xyzw, scale.xyz)
        })
    }
}