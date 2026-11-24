import {PresentationSystemGroup} from "../core";
import {WorldSpaceRenderBoundsComputeSystem} from "./worldSpaceRenderBoundsComputeSystem";
import {TransformInterpolationCaptureSystem} from "./transformInterpolationCaptureSystem";
import {TransformInterpolationBlendSystem} from "./transformInterpolationBlendSystem";
import {TransformInterpolationRestoreSystem} from "./transformInterpolationRestoreSystem";
import {RENDERING_SYSTEM_GROUP_PRIORITY} from "./renderingSystemGroupPriority";

export class RenderingSystemGroup extends PresentationSystemGroup {
    public override onCreate(){
        this.world.ensureSystemExists(WorldSpaceRenderBoundsComputeSystem)
        this.world.ensureSystemExists(TransformInterpolationCaptureSystem)
        this.world.ensureSystemExists(TransformInterpolationBlendSystem)
        this.world.ensureSystemExists(TransformInterpolationRestoreSystem)
    }
    priority(): number {
        return RENDERING_SYSTEM_GROUP_PRIORITY;
    }
}