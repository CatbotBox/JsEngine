import {System, Unchanged} from "../core";
import {InterpolatedTransform} from "../translation/interpolatedTransform";
import {LocalToWorld} from "../translation/localToWorld";
import {MAT4_FLOATS_SHIFT} from "../math/mat4Layout";
import {RenderingSystemGroup} from "./renderingSystemGroup";

const LAST_IN_PRESENTATION_PRIORITY = Number.POSITIVE_INFINITY;
const INTERPOLATED_TRANSFORM_FLOATS = InterpolatedTransform.f32Width;

export class TransformInterpolationRestoreSystem extends System {
    private readonly _query = this.createEntityQuery([InterpolatedTransform, LocalToWorld]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return LAST_IN_PRESENTATION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate(): void {
        if (!this.world.time.interpolatingTicks) return;
        this._query.stream({
            write: {localToWorld: LocalToWorld, interpolation: InterpolatedTransform},
        }).consumeSpans(({start, end, cols}) => {
            const values = cols.interpolation!;
            const localToWorld = cols.localToWorld!;
            let restored = false;
            for (let i = start; i < end; i++) {
                if (InterpolatedTransform.restoreAt(values, i * INTERPOLATED_TRANSFORM_FLOATS, localToWorld, i << MAT4_FLOATS_SHIFT)) restored = true;
            }
            return restored ? undefined : Unchanged;
        });
    }
}
