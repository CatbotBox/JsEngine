import {System, Unchanged} from "../core";
import {RenderBounds} from "./renderBounds";
import {RenderingSystemGroup} from "./renderingSystemGroup";
import {LocalToWorld} from "../translation";
import {anchorFractionX, anchorFractionY, ScreenAnchor} from "./screenAnchor";
import {TextSprite} from "./textSprite";
import {WorldSpaceRenderBoundsComputeSystem} from "./worldSpaceRenderBoundsComputeSystem";
import {AABB_STRIDE, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z} from "../datatypes/aabb";

const PRIORITY_BEFORE_WORLD_BOUNDS = -20;
const CENTER_FRACTION = 0.5;
const FLAT_Z_MIN = 0;
const FLAT_Z_MAX = 1;

export class TextSpriteBoundsSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, TextSprite, RenderBounds]);

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
            read: {image: TextSprite},
            write: {bounds: RenderBounds},
            optional: {anchor: ScreenAnchor},
        }, {
            filterLastUpdated: this.lastUpdateTime,
            structuralFilter: "additions",
            filterBlackList: [RenderBounds]
        }).consumeSpans(({start, end, cols, stores}) => {
            const rb = cols.bounds!;
            const images = stores.image!;
            const anchors = stores.anchor;

            let wrote = false;
            for (let i = start; i < end; i++) {
                const image = images.get(i) as TextSprite;

                let ax = CENTER_FRACTION, ay = CENTER_FRACTION;
                const anchor = anchors?.get(i) as ScreenAnchor | undefined;
                if (anchor !== undefined) {
                    ax = anchorFractionX(anchor.anchorPosition);
                    ay = anchorFractionY(anchor.anchorPosition);
                }

                const sizeX = image.sizeX, sizeY = image.sizeY;
                const x0 = -ax * sizeX;
                const y0 = -ay * sizeY;
                const x1 = x0 + sizeX;
                const y1 = y0 + sizeY;

                const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
                const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);

                const b = i * AABB_STRIDE;
                if (rb[b + AABB_MIN_X] === xMin && rb[b + AABB_MIN_Y] === yMin && rb[b + AABB_MIN_Z] === FLAT_Z_MIN
                    && rb[b + AABB_MAX_X] === xMax && rb[b + AABB_MAX_Y] === yMax && rb[b + AABB_MAX_Z] === FLAT_Z_MAX) {
                    continue;
                }
                rb[b + AABB_MIN_X] = xMin;
                rb[b + AABB_MIN_Y] = yMin;
                rb[b + AABB_MIN_Z] = FLAT_Z_MIN;
                rb[b + AABB_MAX_X] = xMax;
                rb[b + AABB_MAX_Y] = yMax;
                rb[b + AABB_MAX_Z] = FLAT_Z_MAX;
                wrote = true;
            }
            return wrote ? undefined : Unchanged;
        })
    }

}