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
            read: {renderMesh: RenderMesh, localToWorld: LocalToWorld},
            write: {bounds: RenderBounds, worldBounds: WorldSpaceRenderBounds},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            // Derives each entity's output from its own components, so a removal
            // leaves nothing to redo — see EntityFilterOptions.structuralFilter.
            structuralFilter: "additions",
            filterBlackList: [RenderBounds, WorldSpaceRenderBounds],
            // consumeSpans: raw columns for the matrix and both AABBs; the mesh
            // reference is object-backed, fetched per row from its store.
        }).consumeSpans(({start, end, cols, stores}) => {
            const l2w = cols.localToWorld!;
            const rb = cols.bounds!;
            const wb = cols.worldBounds!;
            const meshes = stores.renderMesh!;

            for (let i = start; i < end; i++) {
                const mesh = (meshes.get(i) as RenderMesh).mesh;
                if (mesh === undefined) continue;

                const mb = mesh.bounds;
                const m = i << 4, b = i * 6;

                // Center/extents of the local AABB, pushed through the 3x3 part of
                // the matrix (center exactly, extents via absolute values).
                const cx = (mb[0] + mb[3]) / 2, cy = (mb[1] + mb[4]) / 2, cz = (mb[2] + mb[5]) / 2;
                const ex = (mb[3] - mb[0]) / 2, ey = (mb[4] - mb[1]) / 2, ez = (mb[5] - mb[2]) / 2;

                const wcx = l2w[m] * cx + l2w[m + 4] * cy + l2w[m + 8] * cz;
                const wcy = l2w[m + 1] * cx + l2w[m + 5] * cy + l2w[m + 9] * cz;
                const wcz = l2w[m + 2] * cx + l2w[m + 6] * cy + l2w[m + 10] * cz;

                const wex = Math.abs(l2w[m]) * ex + Math.abs(l2w[m + 4]) * ey + Math.abs(l2w[m + 8]) * ez;
                const wey = Math.abs(l2w[m + 1]) * ex + Math.abs(l2w[m + 5]) * ey + Math.abs(l2w[m + 9]) * ez;
                const wez = Math.abs(l2w[m + 2]) * ex + Math.abs(l2w[m + 6]) * ey + Math.abs(l2w[m + 10]) * ez;

                // AABB layout: [xMin, yMin, zMin, xMax, yMax, zMax]
                rb[b] = wcx - wex;
                rb[b + 1] = wcy - wey;
                rb[b + 2] = wcz - wez;
                rb[b + 3] = wcx + wex;
                rb[b + 4] = wcy + wey;
                rb[b + 5] = wcz + wez;

                wb[b] = l2w[m + 12] + wcx - wex;
                wb[b + 1] = l2w[m + 13] + wcy - wey;
                wb[b + 2] = l2w[m + 14] + wcz - wez;
                wb[b + 3] = l2w[m + 12] + wcx + wex;
                wb[b + 4] = l2w[m + 13] + wcy + wey;
                wb[b + 5] = l2w[m + 14] + wcz + wez;
            }
        });
    }
}
