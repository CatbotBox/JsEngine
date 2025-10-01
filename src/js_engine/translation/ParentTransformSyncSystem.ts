import {System} from "../core";
import {ParentTransform} from "./parent";
import {LocalToWorld} from "./localToWorld";
import {ComponentLookup} from "../core/entityArchetype";
import {VecMath} from "../math/types/vec";

import {HierarchySyncSystem} from "./HierarchySyncSystem";
import {LocalToWorldSystem} from "./LocalToWorldSystem";
import {TranslationSystemGroup} from "./TranslationSystemGroup";
import {Children} from "./children";

export class ParentTransformSyncSystem extends System {
    private _parentQuery = this.createEntityQuery([Children, LocalToWorld])
    private _trackerLookup = new ComponentLookup(this, ParentTransform);

    override systemGroup() {
        return TranslationSystemGroup;
    }

    priority(): number {
        //update after local to world to capture changes
        return this.world.getOrCreateSystem(LocalToWorldSystem).priority() + 1;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._parentQuery);
        this.world.ensureSystemExists(HierarchySyncSystem);
    }


    onUpdate() {
        this._parentQuery.stream({children: Children, localToWorld: LocalToWorld},
            {
                filterLastUpdated: this.lastUpdateTime,
            })
            .forEach(({children, localToWorld}) => {
                children.children.forEach((child) => {
                    const component = this._trackerLookup.tryGetComponent(child)
                    if (component && !VecMath.equals(localToWorld.matrix, component.transform)) {
                        component.transform = localToWorld.matrix
                    }
                })
            })
    }
}