import {SystemGroup} from "../core/";
import {WorldSpaceRenderBoundsComputeSystem} from "./worldSpaceRenderBoundsComputeSystem";

const LATE_FRAME_PRIORITY = 1000;

export class RenderingSystemGroup extends SystemGroup {
    public override onCreate(){
        this.world.ensureSystemExists(WorldSpaceRenderBoundsComputeSystem)
    }
    priority(): number {
        return LATE_FRAME_PRIORITY;
    }
}