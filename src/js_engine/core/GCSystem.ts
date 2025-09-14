import {System} from "./system";

export class GCSystem extends System {
  private time = 0;
  private static timeBeforePrune = 20 * 1000; //20 seconds

  public onUpdate(): void {
    this.time += this.world.time.deltaTime;
    if (this.time <= GCSystem.timeBeforePrune) return;
    const pruneCount = this.world.archetypes.prune();
    this.time = 0
    if (pruneCount > 0) console.info("GC cleared " + pruneCount + " unused archetypes");
  }

}