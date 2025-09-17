import {SystemGroup} from "./systemGroup";

export class RootSystemGroup extends SystemGroup {
  public override create(): void {
    this.onCreate();
  }
}