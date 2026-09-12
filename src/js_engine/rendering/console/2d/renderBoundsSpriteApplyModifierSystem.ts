import {System, Unchanged} from "../../../core";
import {RenderBounds} from "../../renderBounds";
import {RenderingSystemGroup} from "../../renderingSystemGroup";
import {LocalToWorld} from "../../../translation";
import {anchorFractionX, anchorFractionY, ConsoleImageAnchor} from "../index";
import {ConsoleSprite} from "./consoleSprite";
import {WorldSpaceRenderBoundsComputeSystem} from "../../worldSpaceRenderBoundsComputeSystem";

/**
 * Derives a ConsoleSprite's local RenderBounds from its pixel size. One sprite
 * pixel is one cell wide and half a cell tall, so world height is sizeY / 2 —
 * independent of the halfBlockCells setting, which only changes how the shared
 * cell is drawn. The sibling of RenderBounds2DApplyModifierSystem, which does
 * the same for glyph-based ConsoleImages.
 */
export class RenderBoundsSpriteApplyModifierSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, ConsoleSprite, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        // Before WorldSpaceRenderBoundsComputeSystem (-10), like
        // RenderMeshBoundsSystem: a freshly spawned sprite must get its local
        // bounds before the world-space AABB is derived from them.
        return -20;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.ensureSystemExists(WorldSpaceRenderBoundsComputeSystem);
    }

    onUpdate() {
        this._query.stream({
            // ConsoleImageAnchor is not in the query, so it is optional — listing it
            // under `read` would skip every archetype without an anchor.
            read: {sprite: ConsoleSprite},
            write: {bounds: RenderBounds},
            optional: {anchor: ConsoleImageAnchor},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            // Derives each entity's output from its own components, so a removal
            // leaves nothing to redo — see EntityFilterOptions.structuralFilter.
            structuralFilter: "additions",
            filterBlackList: [RenderBounds]
        }).consumeSpans(({start, end, cols, stores}) => {
            // RenderBounds as a raw column; ConsoleSprite/anchor are object-backed.
            const rb = cols.bounds!;
            const sprites = stores.sprite!;
            const anchors = stores.anchor;

            let wrote = false;
            for (let i = start; i < end; i++) {
                const sprite = sprites.get(i) as ConsoleSprite;

                let ax = 0.5, ay = 0.5;
                const anchor = anchors?.get(i) as ConsoleImageAnchor | undefined;
                if (anchor !== undefined) {
                    ax = anchorFractionX(anchor.anchorPosition);
                    ay = anchorFractionY(anchor.anchorPosition);
                }

                // compute top-left corner from anchor; handle negative sizes robustly
                const image = sprite.image;
                const sizeX = image?.sizeX ?? 0, sizeY = (image?.sizeY ?? 0) / 2;
                const x0 = -ax * sizeX;
                const y0 = -ay * sizeY;
                const x1 = x0 + sizeX;
                const y1 = y0 + sizeY;

                const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
                const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);

                // Bounds depend only on the sprite's pixel dimensions, which a
                // tint/opacity change (a fade rewriting them every frame) leaves
                // alone. Skipping the write keeps the RenderBounds column unstamped,
                // which keeps WorldSpaceRenderBoundsComputeSystem and the render
                // pass skipped.
                const b = i * 6; // AABB: [xMin, yMin, zMin, xMax, yMax, zMax]
                if (rb[b] === xMin && rb[b + 1] === yMin && rb[b + 2] === 0
                    && rb[b + 3] === xMax && rb[b + 4] === yMax && rb[b + 5] === 1) {
                    continue;
                }
                rb[b] = xMin;
                rb[b + 1] = yMin;
                rb[b + 2] = 0;
                rb[b + 3] = xMax;
                rb[b + 4] = yMax;
                rb[b + 5] = 1;
                wrote = true;
            }
            return wrote ? undefined : Unchanged;
        })
    }
}
