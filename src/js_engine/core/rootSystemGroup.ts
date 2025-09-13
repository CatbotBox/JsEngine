import {SystemGroup} from "./systemGroup";

export class RootSystemGroup extends SystemGroup {
  public override create(): void {
    // const updateGroup = this.world.getOrCreateSystem(this.updateGroup())
    // updateGroup.addSystem(this.constructor.prototype)
    this.onCreate();
  }
}