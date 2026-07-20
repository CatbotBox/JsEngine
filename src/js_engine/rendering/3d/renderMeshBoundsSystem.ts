import {System} from "../../core";
import {LocalToWorld} from "../../translation";
import {RenderMesh} from "./renderMesh";
import {RenderBounds} from "../renderBounds";
import {WorldSpaceRenderBounds} from "../worldSpaceRenderBounds";
import {RenderingSystemGroup} from "../renderingSystemGroup";

export class RenderMeshBoundsSystem extends System {
    private _query = this.createEntityQuery([RenderMesh, RenderBounds, WorldSpaceRenderBounds, LocalToWorld]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return -20;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate() {
        this._query.stream({
            renderMesh: RenderMesh,
            bounds: RenderBounds,
            worldBounds: WorldSpaceRenderBounds,
            localToWorld: LocalToWorld,
        }, {
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [RenderBounds, WorldSpaceRenderBounds],
        }).forEach(({renderMesh, bounds, worldBounds, localToWorld}) => {
            const mesh = renderMesh.mesh;
            if (mesh === undefined) return;

            const mb = mesh.bounds;
            const m = localToWorld.matrix;

            // Some matrix magic

            // Center/extents of the local AABB, pushed through the 3x3 part of
            // the matrix (center exactly, extents via absolute values).
            const cx = (mb[0] + mb[3]) / 2, cy = (mb[1] + mb[4]) / 2, cz = (mb[2] + mb[5]) / 2;
            const ex = (mb[3] - mb[0]) / 2, ey = (mb[4] - mb[1]) / 2, ez = (mb[5] - mb[2]) / 2;

            const wcx = m[0] * cx + m[4] * cy + m[8] * cz;
            const wcy = m[1] * cx + m[5] * cy + m[9] * cz;
            const wcz = m[2] * cx + m[6] * cy + m[10] * cz;

            const wex = Math.abs(m[0]) * ex + Math.abs(m[4]) * ey + Math.abs(m[8]) * ez;
            const wey = Math.abs(m[1]) * ex + Math.abs(m[5]) * ey + Math.abs(m[9]) * ez;
            const wez = Math.abs(m[2]) * ex + Math.abs(m[6]) * ey + Math.abs(m[10]) * ez;

            bounds.xMin = wcx - wex;
            bounds.xMax = wcx + wex;
            bounds.yMin = wcy - wey;
            bounds.yMax = wcy + wey;
            bounds.zMin = wcz - wez;
            bounds.zMax = wcz + wez;

            worldBounds.xMin = m[12] + wcx - wex;
            worldBounds.xMax = m[12] + wcx + wex;
            worldBounds.yMin = m[13] + wcy - wey;
            worldBounds.yMax = m[13] + wcy + wey;
            worldBounds.zMin = m[14] + wcz - wez;
            worldBounds.zMax = m[14] + wcz + wez;
        });
    }
}
