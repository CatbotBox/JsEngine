import {SystemGroup} from "../core";
import {ParentTransform} from "./parent";

const DEFAULT_MAX_CASCADE_ITERATIONS = 1000;

export class TranslationSystemGroup extends SystemGroup {
    public maxCascadeIterationsPerUpdate: number = DEFAULT_MAX_CASCADE_ITERATIONS;
    private _parentQuery = this.createEntityQuery([ParentTransform])

    onUpdate() {
        let cyclesLeft = this.maxCascadeIterationsPerUpdate;
        do {
            super.onUpdate();
            cyclesLeft--;
            const changed = this._parentQuery.stream({
                read: {parentTransform: ParentTransform},
            }, {
                filterLastUpdated: this.lastUpdateTime,
            }).hasAny();
            if (!changed) {
                return;
            }
            this.updateLastUpdateTime();
        }
        while (cyclesLeft > 0)

    }
}