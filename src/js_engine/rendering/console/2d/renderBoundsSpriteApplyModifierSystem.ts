import {System, Unchanged} from "../../../core";
import {RenderBounds} from "../../renderBounds";
import {RenderingSystemGroup} from "../../renderingSystemGroup";
import {LocalToWorld} from "../../../translation";
import {anchorFractionX, anchorFractionY, ConsoleImageAnchor} from "../index";
import {Sprite} from "../../2d/sprite";
import {WorldSpaceRenderBoundsComputeSystem} from "../../worldSpaceRenderBoundsComputeSystem";
import {AABB_STRIDE} from "../../../datatypes/aabb";

const PRIORITY_BEFORE_WORLD_BOUNDS = -20;
const CENTER_FRACTION = 0.5;
const PIXEL_ROWS_PER_CELL = 2;
const FLAT_Z_MIN = 0;
const FLAT_Z_MAX = 1;

export class RenderBoundsSpriteApplyModifierSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, Sprite, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_BEFORE_WORLD_BOUNDS;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.ensureSystemExists(WorldSpaceRenderBoundsComputeSystem);
    }

    onUpdate() {
        this._query.stream({
            read: {sprite: Sprite},
            write: {bounds: RenderBounds},
            optional: {anchor: ConsoleImageAnchor},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            structuralFilter: "additions",
            filterBlackList: [RenderBounds]
        }).consumeSpans(({start, end, cols, stores}) => {
            const rb = cols.bounds!;
            const sprites = stores.sprite!;
            const anchors = stores.anchor;

            let wrote = false;
            for (let i = start; i < end; i++) {
                const sprite = sprites.get(i) as Sprite;

                let ax = CENTER_FRACTION, ay = CENTER_FRACTION;
                const anchor = anchors?.get(i) as ConsoleImageAnchor | undefined;
                if (anchor !== undefined) {
                    ax = anchorFractionX(anchor.anchorPosition);
                    ay = anchorFractionY(anchor.anchorPosition);
                }

                const image = sprite.image;
                const sizeX = image?.sizeX ?? 0, sizeY = (image?.sizeY ?? 0) / PIXEL_ROWS_PER_CELL;
                const x0 = -ax * sizeX;
                const y0 = -ay * sizeY;
                const x1 = x0 + sizeX;
                const y1 = y0 + sizeY;

                const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
                const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);

                const b = i * AABB_STRIDE;
                if (rb[b] === xMin && rb[b + 1] === yMin && rb[b + 2] === FLAT_Z_MIN
                    && rb[b + 3] === xMax && rb[b + 4] === yMax && rb[b + 5] === FLAT_Z_MAX) {
                    continue;
                }
                rb[b] = xMin;
                rb[b + 1] = yMin;
                rb[b + 2] = FLAT_Z_MIN;
                rb[b + 3] = xMax;
                rb[b + 4] = yMax;
                rb[b + 5] = FLAT_Z_MAX;
                wrote = true;
            }
            return wrote ? undefined : Unchanged;
        })
    }
}
