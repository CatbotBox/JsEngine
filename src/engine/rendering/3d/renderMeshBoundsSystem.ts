import {System} from "../../core";
import {LocalToWorld} from "../../translation";
import {RenderMesh} from "./renderMesh";
import {RenderBounds} from "../renderBounds";
import {WorldSpaceRenderBounds} from "../worldSpaceRenderBounds";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {AABB_STRIDE, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z} from "../../datatypes/aabb";
import {MAT4_FLOATS_SHIFT, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../math/mat4Layout";

const PRIORITY_BEFORE_WORLD_BOUNDS = -20;

export class RenderMeshBoundsSystem extends System {
    private _query = this.createEntityQuery([RenderMesh, RenderBounds, WorldSpaceRenderBounds, LocalToWorld]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_BEFORE_WORLD_BOUNDS;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate() {
        this._query.stream({
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld},
            write: {bounds: RenderBounds, worldBounds: WorldSpaceRenderBounds},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            structuralFilter: "additions",
            filterBlackList: [RenderBounds, WorldSpaceRenderBounds],
        }).consumeSpans(({start, end, cols, stores}) => {
            const l2w = cols.localToWorld!;
            const rb = cols.bounds!;
            const wb = cols.worldBounds!;
            const meshes = stores.renderMesh!;

            for (let i = start; i < end; i++) {
                const mesh = (meshes.get(i) as RenderMesh).mesh;
                if (mesh === undefined) continue;

                const mb = mesh.bounds;
                const m = i << MAT4_FLOATS_SHIFT, b = i * AABB_STRIDE;

                const cx = (mb[AABB_MIN_X] + mb[AABB_MAX_X]) / 2, cy = (mb[AABB_MIN_Y] + mb[AABB_MAX_Y]) / 2, cz = (mb[AABB_MIN_Z] + mb[AABB_MAX_Z]) / 2;
                const ex = (mb[AABB_MAX_X] - mb[AABB_MIN_X]) / 2, ey = (mb[AABB_MAX_Y] - mb[AABB_MIN_Y]) / 2, ez = (mb[AABB_MAX_Z] - mb[AABB_MIN_Z]) / 2;

                const wcx = l2w[m] * cx + l2w[m + 4] * cy + l2w[m + 8] * cz;
                const wcy = l2w[m + 1] * cx + l2w[m + 5] * cy + l2w[m + 9] * cz;
                const wcz = l2w[m + 2] * cx + l2w[m + 6] * cy + l2w[m + 10] * cz;

                const wex = Math.abs(l2w[m]) * ex + Math.abs(l2w[m + 4]) * ey + Math.abs(l2w[m + 8]) * ez;
                const wey = Math.abs(l2w[m + 1]) * ex + Math.abs(l2w[m + 5]) * ey + Math.abs(l2w[m + 9]) * ez;
                const wez = Math.abs(l2w[m + 2]) * ex + Math.abs(l2w[m + 6]) * ey + Math.abs(l2w[m + 10]) * ez;

                rb[b + AABB_MIN_X] = wcx - wex;
                rb[b + AABB_MIN_Y] = wcy - wey;
                rb[b + AABB_MIN_Z] = wcz - wez;
                rb[b + AABB_MAX_X] = wcx + wex;
                rb[b + AABB_MAX_Y] = wcy + wey;
                rb[b + AABB_MAX_Z] = wcz + wez;

                wb[b + AABB_MIN_X] = l2w[m + MAT4_TRANSLATION_X] + wcx - wex;
                wb[b + AABB_MIN_Y] = l2w[m + MAT4_TRANSLATION_Y] + wcy - wey;
                wb[b + AABB_MIN_Z] = l2w[m + MAT4_TRANSLATION_Z] + wcz - wez;
                wb[b + AABB_MAX_X] = l2w[m + MAT4_TRANSLATION_X] + wcx + wex;
                wb[b + AABB_MAX_Y] = l2w[m + MAT4_TRANSLATION_Y] + wcy + wey;
                wb[b + AABB_MAX_Z] = l2w[m + MAT4_TRANSLATION_Z] + wcz + wez;
            }
        });
    }
}
