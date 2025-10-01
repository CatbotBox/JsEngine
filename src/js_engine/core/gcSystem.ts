import {System} from "./system";

const TIME_BEFORE_PRUNE = 20 * 1000; //20 seconds
const TIME_BEFORE_PRUNE_OPTIMISTIC = 120 * 1000; //120 seconds
export class GcSystem extends System {
    private time = 0;

    public onUpdate(): void {
        this.time -= this.world.time.deltaTime;
        if (this.time > 0) return;
        const pruneCount = this.world.archetypes.prune();
        if (pruneCount > 0) {
            console.info("GC cleared " + pruneCount + " unused archetypes");
            this.time = TIME_BEFORE_PRUNE;
        } else {
            this.time = TIME_BEFORE_PRUNE_OPTIMISTIC;
        }
    }

}