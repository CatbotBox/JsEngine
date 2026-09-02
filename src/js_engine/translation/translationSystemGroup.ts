import {SystemGroup} from "../core/";
import {ParentTransform} from "./parent";

export class TranslationSystemGroup extends SystemGroup {
    /**
     * this is not a hard limit for hierarchy, it dictates how many levels of hierarchy can be processed in a single update
     *
     * this value can be adjusted
     */
    public maxCascadeIterationsPerUpdate: number = 1000;
    private _parentQuery = this.createEntityQuery([ParentTransform])

    onUpdate() {
        let cyclesLeft = this.maxCascadeIterationsPerUpdate;
        // keep rerunning until stable to ensure transforms are properly cascaded down
        do {
            super.onUpdate();
            cyclesLeft--;
            const changed = this._parentQuery.stream({
                read: {parentTransform: ParentTransform},
            }, {
                filterLastUpdated: this.lastUpdateTime,
            }).hasAny();
            if (!changed) {
                // nothing to update just exit;
                return;
            }
            this.updateLastUpdateTime();
        }
        while (cyclesLeft > 0)

    }
}