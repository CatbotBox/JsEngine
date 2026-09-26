import {System, Unchanged} from "../core";
import {LocalToWorld} from "../translation";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";
import {RenderBounds} from "./renderBounds";
import {RenderingSystemGroup} from "./renderingSystemGroup";
import {LocalToWorldSystem} from "../translation/localToWorldSystem";
import {RenderBoundsOffset} from "./renderBoundsOffset";

export class WorldSpaceRenderBoundsComputeSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, WorldSpaceRenderBounds, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.ensureSystemExists(LocalToWorldSystem);
    }

    onUpdate() {
        this._query.stream({
            // RenderBoundsOffset is not in the query, so it is optional � the body
            // already reads it as offset?.x.
            read: {bounds: RenderBounds, localToWorld: LocalToWorld},
            write: {worldBounds: WorldSpaceRenderBounds},
            optional: {offset: RenderBoundsOffset},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            // Derives each entity's output from its own components, so a removal
            // leaves nothing to redo — see EntityFilterOptions.structuralFilter.
            structuralFilter: "additions",
            // Only the system's own write column may be blacklisted. RenderBounds
            // is a read here: blacklisting it severed the wake-up from the
            // apply-modifier systems that derive it, so sprites kept a stale
            // point-AABB until their LocalToWorld happened to be re-stamped —
            // and then visibly jumped by the anchor offset.
            filterBlackList: [WorldSpaceRenderBounds]
        }).consumeSpans(({start, end, cols, stores}) => {
            // SoA hot path: LocalToWorld (16), RenderBounds (6) and
            // WorldSpaceRenderBounds (6) as raw columns; RenderBoundsOffset is
            // object-backed and rare, fetched per row from its store.
            const l2w = cols.localToWorld!;
            const rb = cols.bounds!;
            const wb = cols.worldBounds!;
            const offStore = stores.offset;

            // A stationary entity produces the same world bounds every frame. This runs
            // whenever LocalToWorld is stamped, which happens for a whole archetype as
            // soon as one entity is added to it — so most of the entities reaching here
            // have not actually moved. Declining the write (span-granular, same as the
            // stamp itself) keeps the render pass from rebatching them.
            let wrote = false;
            for (let i = start; i < end; i++) {
                const m = i << 4, b = i * 6;
                let px = l2w[m + 12], py = l2w[m + 13], pz = l2w[m + 14];
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