import {System} from "../../core";
import {LocalToWorld} from "../../translation";
import {RenderMesh} from "./renderMesh";
import {RenderBounds} from "../renderBounds";
import {WorldSpaceRenderBounds} from "../worldSpaceRenderBounds";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {AABB_STRIDE} from "../../datatypes/aabb";

const PRIORITY_BEFORE_WORLD_BOUNDS = -20;
const TRANSLATION_X = 12;
const TRANSLATION_Y = 13;
const TRANSLATION_Z = 14;

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
                const m = i << 4, b = i * AABB_STRIDE;

                const cx = (mb[0] + mb[3]) / 2, cy = (mb[1] + mb[4]) / 2, cz = (mb[2] + mb[5]) / 2;
                const ex = (mb[3] - mb[0]) / 2, ey = (mb[4] - mb[1]) / 2, ez = (mb[5] - mb[2]) / 2;

                const wcx = l2w[m] * cx + l2w[m + 4] * cy + l2w[m + 8] * cz;
                const wcy = l2w[m + 1] * cx + l2w[m + 5] * cy + l2w[m + 9] * cz;
                const wcz = l2w[m + 2] * cx + l2w[m + 6] * cy + l2w[m + 10] * cz;

                const wex = Math.abs(l2w[m]) * ex + Math.abs(l2w[m + 4]) * ey + Math.abs(l2w[m + 8]) * ez;
                const wey = Math.abs(l2w[m + 1]) * ex + Math.abs(l2w[m + 5]) * ey + Math.abs(l2w[m + 9]) * ez;
                const wez = Math.abs(l2w[m + 2]) * ex + Math.abs(l2w[m + 6]) * ey + Math.abs(l2w[m + 10]) * ez;

                rb[b] = wcx - wex;
                rb[b + 1] = wcy - wey;
                rb[b + 2] = wcz - wez;
                rb[b + 3] = wcx + wex;
                rb[b + 4] = wcy + wey;
                rb[b + 5] = wcz + wez;

                wb[b] = l2w[m + TRANSLATION_X] + wcx - wex;
                wb[b + 1] = l2w[m + TRANSLATION_Y] + wcy - wey;
                wb[b + 2] = l2w[m + TRANSLATION_Z] + wcz - wez;
                wb[b + 3] = l2w[m + TRANSLATION_X] + wcx + wex;
                wb[b + 4] = l2w[m + TRANSLATION_Y] + wcy + wey;
                wb[b + 5] = l2w[m + TRANSLATION_Z] + wcz + wez;
            }
        });
    }
}
