import {System} from "./system";

const PRUNE_INTERVAL_AFTER_HIT_MS = 20 * 1000;
const PRUNE_INTERVAL_AFTER_MISS_MS = 120 * 1000;
export class GcSystem extends System {
    private _msUntilNextPrune = 0;

    public onUpdate(): void {
        this._msUntilNextPrune -= this.world.time.deltaTime;
        if (this._msUntilNextPrune > 0) return;
        const pruneCount = this.world.archetypes.prune();
        if (pruneCount > 0) {
            this._msUntilNextPrune = PRUNE_INTERVAL_AFTER_HIT_MS;
        } else {
            this._msUntilNextPrune = PRUNE_INTERVAL_AFTER_MISS_MS;
        }
    }

}