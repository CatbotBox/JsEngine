import {System} from "../core";
import {LocalPosition} from "./localPosition";
import {LocalToWorld} from "./localToWorld";
import {LocalRotation} from "./localRotation";
import {LocalScale} from "./localScale";
import {Parent, ParentTransform} from "./parent";
import {ParentTransformSyncSystem} from "./parentTransformSyncSystem";
import {TranslationSystemGroup} from "./translationSystemGroup";

const EARLY_TRANSLATION_PRIORITY = -10;
const POSITION_FLOATS = 3;
const ROTATION_FLOATS = 4;
const SCALE_FLOATS = 3;
const MATRIX_FLOATS_SHIFT = 4;

export class LocalToWorldSystem extends System {
    private _baseQuery = this.createEntityQuery([LocalPosition, LocalToWorld])

    override systemGroup() {
        return TranslationSystemGroup;
    }

    override priority(): number {
        return EARLY_TRANSLATION_PRIORITY;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._baseQuery);
        this.world.ensureSystemExists(ParentTransformSyncSystem)
    }

    onUpdate() {
        this._baseQuery.stream({
            read: {position: LocalPosition},
            write: {localToWorld: LocalToWorld},
            optional: {
                localRotation: LocalRotation,
                localScale: LocalScale,
                parentTransform: ParentTransform,
            },
        }, {
            filterLastUpdated: this.lastUpdateTime,
            structuralFilter: "additions",
            filterBlackList: [LocalToWorld],
        }).consumeSpans(({start, end, cols}) => {
            const pos = cols.position!;
            const out = cols.localToWorld!;
            const rot = cols.localRotation;
            const scl = cols.localScale;
            const par = cols.parentTransform;

            for (let i = start; i < end; i++) {
                let qx = 0, qy = 0, qz = 0, qw = 1;
                if (rot !== undefined) {
                    const r = i * ROTATION_FLOATS;
                    qx = rot[r];
                    qy = rot[r + 1];
                    qz = rot[r + 2];
                    qw = rot[r + 3];
                }
                let sx = 1, sy = 1, sz = 1;
                if (scl !== undefined) {
                    const s = i * SCALE_FLOATS;
                    sx = scl[s];
                    sy = scl[s + 1];
                    sz = scl[s + 2];
                }
                const p = i * POSITION_FLOATS, o = i << MATRIX_FLOATS_SHIFT;
                LocalToWorld.fromTRSAt(out, o, pos[p], pos[p + 1], pos[p + 2], qx, qy, qz, qw, sx, sy, sz);
                if (par !== undefined) LocalToWorld.mulAt(par, o, out, o, out, o);
            }
        });
    }
}

