import {System} from "../core";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {Parent, ParentTransform} from "./parent";
import {ParentTransformSyncSystem} from "./ParentTransformSyncSystem";
import {TranslationSystemGroup} from "./TranslationSystemGroup";

export class LocalToWorldSystem extends System {
    private _baseQuery = this.createEntityQuery([LocalPosition, LocalToWorld])

    override systemGroup() {
        return TranslationSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._baseQuery);
        this.world.ensureSystemExists(ParentTransformSyncSystem)
    }

    onUpdate() {
        this._baseQuery.stream({
            // The query only requires [LocalPosition, LocalToWorld]. Everything else
            // is optional — most entities have no rotation, scale or parent, and the
            // body below substitutes defaults. Listing them under `read` would skip
            // every archetype lacking them, which silently leaves those entities on
            // an identity matrix.
            read: {position: LocalPosition},
            write: {localToWorld: LocalToWorld},
            optional: {
                localRotation: LocalRotation,
                localScale: LocalScale,
                parentTransform: ParentTransform,
            },
        }, {
            filterLastUpdated: this.lastUpdateTime,
            // Derives each entity's output from its own components, so a removal
            // leaves nothing to redo — see EntityFilterOptions.structuralFilter.
            structuralFilter: "additions",
            filterBlackList: [LocalToWorld],
            // consumeSpans, not consume: raw Float32Array columns and a row
            // range, no per-entity objects at all. Measured at 4-20x the row path.
        }).consumeSpans(({start, end, cols}) => {
            const pos = cols.position!;         // width 3
            const out = cols.localToWorld!;     // width 16
            const rot = cols.localRotation;     // width 4, or absent
            const scl = cols.localScale;        // width 3, or absent
            const par = cols.parentTransform;   // width 16, or absent

            for (let i = start; i < end; i++) {
                let qx = 0, qy = 0, qz = 0, qw = 1;
                if (rot !== undefined) {
                    const r = i * 4;
                    qx = rot[r];
                    qy = rot[r + 1];
                    qz = rot[r + 2];
                    qw = rot[r + 3];
                }
                let sx = 1, sy = 1, sz = 1;
                if (scl !== undefined) {
                    const s = i * 3;
                    sx = scl[s];
                    sy = scl[s + 1];
                    sz = scl[s + 2];
                }
                const p = i * 3, o = i << 4;
                LocalToWorld.fromTRSAt(out, o, pos[p], pos[p + 1], pos[p + 2], qx, qy, qz, qw, sx, sy, sz);
                if (par !== undefined) LocalToWorld.mulAt(par, o, out, o, out, o);
            }
        });
    }
}

