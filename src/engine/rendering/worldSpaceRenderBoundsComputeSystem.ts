import {System, Unchanged} from "../core";
import {LocalToWorld} from "../translation";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";
import {RenderBounds} from "./renderBounds";
import {RenderingSystemGroup} from "./renderingSystemGroup";
import {LocalToWorldSystem} from "../translation/localToWorldSystem";
import {RenderBoundsOffset} from "./renderBoundsOffset";
import {AABB_STRIDE, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z} from "../datatypes/aabb";
import {MAT4_FLOATS_SHIFT, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../math/mat4Layout";

const PRIORITY_BEFORE_RENDER_PASSES = -10;

export class WorldSpaceRenderBoundsComputeSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, WorldSpaceRenderBounds, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_BEFORE_RENDER_PASSES;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.ensureSystemExists(LocalToWorldSystem);
    }

    onUpdate() {
        this._query.stream({
            read: {bounds: RenderBounds, localToWorld: LocalToWorld},
            write: {worldBounds: WorldSpaceRenderBounds},
            optional: {offset: RenderBoundsOffset},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            structuralFilter: "additions",
            filterBlackList: [WorldSpaceRenderBounds]
        }).consumeSpans(({start, end, cols, stores}) => {
            const l2w = cols.localToWorld!;
            const rb = cols.bounds!;
            const wb = cols.worldBounds!;
            const offStore = stores.offset;

            let wrote = false;
            for (let i = start; i < end; i++) {
                const m = i << MAT4_FLOATS_SHIFT, b = i * AABB_STRIDE;
                let px = l2w[m + MAT4_TRANSLATION_X], py = l2w[m + MAT4_TRANSLATION_Y], pz = l2w[m + MAT4_TRANSLATION_Z];
                if (offStore !== undefined) {
                    const o = offStore.get(i) as RenderBoundsOffset;
                    px += o.x;
                    py += o.y;
                    pz += o.z;
                }
                const xMin = px + rb[b + AABB_MIN_X], yMin = py + rb[b + AABB_MIN_Y], zMin = pz + rb[b + AABB_MIN_Z];
                const xMax = px + rb[b + AABB_MAX_X], yMax = py + rb[b + AABB_MAX_Y], zMax = pz + rb[b + AABB_MAX_Z];

                if (wb[b + AABB_MIN_X] === xMin && wb[b + AABB_MIN_Y] === yMin && wb[b + AABB_MIN_Z] === zMin
                    && wb[b + AABB_MAX_X] === xMax && wb[b + AABB_MAX_Y] === yMax && wb[b + AABB_MAX_Z] === zMax) {
                    continue;
                }
                wb[b + AABB_MIN_X] = xMin;
                wb[b + AABB_MIN_Y] = yMin;
                wb[b + AABB_MIN_Z] = zMin;
                wb[b + AABB_MAX_X] = xMax;
                wb[b + AABB_MAX_Y] = yMax;
                wb[b + AABB_MAX_Z] = zMax;
                wrote = true;
            }
            return wrote ? undefined : Unchanged;
        })
    }

}