import {System, Unchanged} from "../core";
import {InterpolatedTransform} from "../translation/interpolatedTransform";
import {LocalToWorld} from "../translation/localToWorld";
import {MAT4_FLOATS_SHIFT} from "../math/mat4Layout";
import {RenderingSystemGroup} from "./renderingSystemGroup";

const FIRST_IN_PRESENTATION_PRIORITY = Number.NEGATIVE_INFINITY;
const INTERPOLATED_TRANSFORM_FLOATS = InterpolatedTransform.f32Width;

export class TransformInterpolationBlendSystem extends System {
    private readonly _query = this.createEntityQuery([InterpolatedTransform, LocalToWorld]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return FIRST_IN_PRESENTATION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate(): void {
        const time = this.world.time;
        if (!time.interpolatingTicks) return;
        const tickCount = time.tickCount;
        const tickAlpha = time.tickAlpha;
        this._query.stream({
            write: {localToWorld: LocalToWorld, interpolation: InterpolatedTransform},
        }).consumeSpans(({start, end, cols}) => {
            const values = cols.interpolation!;
            const localToWorld = cols.localToWorld!;
            let blended = false;
            for (let i = start; i < end; i++) {
                if (InterpolatedTransform.blendAt(values, i * INTERPOLATED_TRANSFORM_FLOATS, localToWorld, i << MAT4_FLOATS_SHIFT, tickCount, tickAlpha)) blended = true;
            }
            return blended ? undefined : Unchanged;
        });
    }
}
