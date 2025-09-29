import {System} from "../core";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {Parent, ParentTransform} from "./parent";
import {ComponentLookup} from "../core/entityArchetype";
import {ParentTransformSyncSystem} from "./ParentTransformSyncSystem";
import {TranslationSystemGroup} from "./TranslationSystemGroup";

export class LocalToWorldSystem extends System {
    private _baseQuery = this.createEntityQuery([LocalPosition, LocalToWorld])

    override systemGroup() {
        return TranslationSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._baseQuery);
        this.world.ensureSystemExists(ParentTransformSyncSystem)
    }

    onUpdate() {
        this._baseQuery.stream({
            localRotation: LocalRotation,
            localToWorld: LocalToWorld,
            position: LocalPosition,
            localScale: LocalScale,
            parentTransform: ParentTransform
        }, {
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [LocalToWorld],
        }).forEach(({localToWorld, position, localRotation, localScale, parentTransform}) => {
            const pos = position
            const rotation = localRotation ?? new LocalRotation();
            const scale = localScale ?? new LocalScale();

            localToWorld.setTRS(pos.xyz, rotation.xyzw, scale.xyz)

            if (parentTransform === undefined) {
                return;
            }
            localToWorld.mul(parentTransform.transform);
        });
    }
}

