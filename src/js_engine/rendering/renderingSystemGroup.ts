import {SystemGroup} from "../core/";
import {WorldSpaceRenderBoundsComputeSystem} from "./worldSpaceRenderBoundsComputeSystem";

export class RenderingSystemGroup extends SystemGroup {
    public override onCreate(){
        this.world.ensureSystemExists(WorldSpaceRenderBoundsComputeSystem)
    }
    priority(): number {
        return 1000; // rendering should be done as late as possible
    }
}