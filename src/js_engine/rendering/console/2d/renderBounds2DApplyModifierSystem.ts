import {System, Unchanged} from "../../../core";
import {RenderBounds} from "../../renderBounds";
import {RenderingSystemGroup} from "../../renderingSystemGroup";
import {LocalToWorld} from "../../../translation";
import {ConsoleImageAnchor} from "../index";
import {ConsoleImage} from "../index";
import {WorldSpaceRenderBoundsComputeSystem} from "../../worldSpaceRenderBoundsComputeSystem";

export class RenderBounds2DApplyModifierSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, ConsoleImage, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.ensureSystemExists(WorldSpaceRenderBoundsComputeSystem);
    }

    onUpdate() {
        this._query.stream({
            // ConsoleImageAnchor is not in the query, so it is optional — listing it
            // under `read` would skip every archetype without an anchor.
            read: {image: ConsoleImage},
            write: {bounds: RenderBounds},
            optional: {anchor: ConsoleImageAnchor},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            // Derives each entity's output from its own components, so a removal
            // leaves nothing to redo — see EntityFilterOptions.structuralFilter.
            structuralFilter: "additions",
            filterBlackList: [RenderBounds]
        }).consumeSpans(({start, end, cols, stores}) => {
            // RenderBounds as a raw column; ConsoleImage/anchor are object-backed.
            const rb = cols.bounds!;
            const images = stores.image!;
            const anchors = stores.anchor;

            let wrote = false;
            for (let i = start; i < end; i++) {
                const image = images.get(i) as ConsoleImage;

                // Fractional anchor (0=left/top, 0.5=center/middle, 1=right/bottom).
                //
                // Almost no entity has an anchor. The previous version still ran
                // `anchor?.anchorPosition.split('-') || ["middle","center"]` for every one
                // of them, which allocated a two-element array and destructured it through
                // the iterator protocol, per entity per frame, to arrive at two constants.
                // startsWith/endsWith avoids both the split and the destructure.
                let ax = 0.5, ay = 0.5;
                const anchor = anchors?.get(i) as ConsoleImageAnchor | undefined;
                if (anchor !== undefined) {
                    const p = anchor.anchorPosition;
                    ax = p.endsWith('left') ? 0 : p.endsWith('center') ? 0.5 : 1;
                    ay = p.startsWith('top') ? 0 : p.startsWith('middle') ? 0.5 : 1;
                }

                // compute top-left corner from anchor; handle negative sizes robustly
                const sizeX = image.sizeX, sizeY = image.sizeY;
                const x0 = -ax * sizeX;
                const y0 = -ay * sizeY;
                const x1 = x0 + sizeX;
                const y1 = y0 + sizeY;

                const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
                const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);

                // Bounds depend only on the image's glyph dimensions, which a colour-only
                // change (a fade rewriting `image.image` every frame) leaves alone. Skipping
                // the write keeps the RenderBounds column unstamped, which in turn keeps
                // WorldSpaceRenderBoundsComputeSystem and the render pass skipped.
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