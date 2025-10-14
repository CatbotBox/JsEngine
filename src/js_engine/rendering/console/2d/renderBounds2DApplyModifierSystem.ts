import {System} from "../../../core";
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
            anchor: ConsoleImageAnchor,
            bounds: RenderBounds,
            image: ConsoleImage,
        }, {
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [RenderBounds]
        }).forEach(({bounds, image, anchor}) => {

            // parse anchor -> fractional anchor (0=left/top, 0.5=center/middle, 1=right/bottom)
            const [v, h] = anchor?.anchorPosition.split('-') as [
                    'top' | 'middle' | 'bottom',
                    'left' | 'center' | 'right'
            ] || ["middle", "center"];

            const ax = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;    // horizontal anchor
            const ay = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;     // vertical anchor

            // compute top-left corner from anchor; handle negative sizes robustly
            const x0 =  - ax * image.sizeX;
            const y0 =  - ay * image.sizeY;
            const x1 = x0 + image.sizeX;
            const y1 = y0 + image.sizeY;;

            bounds.xMin = Math.min(x0, x1);
            bounds.xMax = Math.max(x0, x1);
            bounds.yMin = Math.min(y0, y1);
            bounds.yMax = Math.max(y0, y1);
            bounds.zMin = 0
            bounds.zMax = 1
        })
    }

}