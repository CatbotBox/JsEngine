import {EntityCommandBufferSystem, System} from "../core";
import {InterpolatedTransform, InterpolatedTransformSnap} from "../translation/interpolatedTransform";
import {LocalToWorld} from "../translation/localToWorld";
import {MAT4_FLOATS_SHIFT} from "../math/mat4Layout";
import {RENDERING_SYSTEM_GROUP_PRIORITY} from "./renderingSystemGroupPriority";

const PRIORITY_STEP = 1;
const PRIORITY_BEFORE_PRESENTATION = RENDERING_SYSTEM_GROUP_PRIORITY - PRIORITY_STEP;
const INTERPOLATED_TRANSFORM_FLOATS = InterpolatedTransform.f32Width;

export class TransformInterpolationCaptureSystem extends System {
    private readonly _interpolated = this.createEntityQuery([InterpolatedTransform, LocalToWorld]);
    private readonly _snaps = this.createEntityQuery([InterpolatedTransformSnap]);

    override priority(): number {
        return PRIORITY_BEFORE_PRESENTATION;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._interpolated);
        this.requireAnyForUpdate(this._snaps);
    }

    onUpdate(): void {
        const tickCount = this.world.time.tickCount;
        this._interpolated.stream({
            read: {localToWorld: LocalToWorld},
            write: {interpolation: InterpolatedTransform},
            optional: {snap: InterpolatedTransformSnap},
        }).consumeSpans(({start, end, cols, stores}) => {
            const values = cols.interpolation!;
            const localToWorld = cols.localToWorld!;
            const restart = stores.snap !== undefined;
            for (let i = start; i < end; i++) {
                InterpolatedTransform.captureAt(values, i * INTERPOLATED_TRANSFORM_FLOATS, localToWorld, i << MAT4_FLOATS_SHIFT, tickCount, restart);
            }
        });
        this.removeSnaps();
    }

    private removeSnaps(): void {
        if (!this._snaps.hasEntity()) return;
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        this._snaps.stream({read: {snap: InterpolatedTransformSnap}}).consumeSpans(({start, end, entities}) => {
            for (let i = start; i < end; i++) buffer.removeComponent(entities[i], InterpolatedTransformSnap);
        });
    }
}
