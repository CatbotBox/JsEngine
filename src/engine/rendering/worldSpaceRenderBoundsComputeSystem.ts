import {System, Unchanged} from "../core";
import {LocalToWorld} from "../translation";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";
import {RenderBounds} from "./renderBounds";
import {RenderingSystemGroup} from "./renderingSystemGroup";
import {LocalToWorldSystem} from "../translation/localToWorldSystem";
import {RenderBoundsOffset} from "./renderBoundsOffset";
import {AABB_STRIDE} from "../datatypes/aabb";

const PRIORITY_BEFORE_RENDER_PASSES = -10;
const TRANSLATION_X = 12;
const TRANSLATION_Y = 13;
const TRANSLATION_Z = 14;

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
                const m = i << 4, b = i * AABB_STRIDE;
                let px = l2w[m + TRANSLATION_X], py = l2w[m + TRANSLATION_Y], pz = l2w[m + TRANSLATION_Z];
                if (offStore !== undefined) {
                    const o = offStore.get(i) as RenderBoundsOffset;
                    px += o.x;
                    py += o.y;
                    pz += o.z;
                }
                const xMin = px + rb[b], yMin = py + rb[b + 1], zMin = pz + rb[b + 2];
                const xMax = px + rb[b + 3], yMax = py + rb[b + 4], zMax = pz + rb[b + 5];

                if (wb[b] === xMin && wb[b + 1] === yMin && wb[b + 2] === zMin
                    && wb[b + 3] === xMax && wb[b + 4] === yMax && wb[b + 5] === zMax) {
                    continue;
                }
                wb[b] = xMin;
                wb[b + 1] = yMin;
                wb[b + 2] = zMin;
                wb[b + 3] = xMax;
                wb[b + 4] = yMax;
                wb[b + 5] = zMax;
                wrote = true;
            }
            return wrote ? undefined : Unchanged;
        })
    }

}