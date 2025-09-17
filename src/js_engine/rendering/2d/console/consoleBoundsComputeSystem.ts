import {System} from "../../../core";
import {ConsoleImage, ConsoleImageAnchor, ConsoleImageOffset} from "./components";
import {RenderBounds} from "../../renderBounds";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";
import {LocalToWorldSystem} from "../../../translation/LocalToWorldSystem";
import {LocalToWorld} from "../../../translation/localToWorld";

export class ConsoleBoundsComputeSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, ConsoleImage, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.getOrCreateSystem(LocalToWorldSystem);
    }

    onUpdate() {
        this._query.stream({
            anchor: ConsoleImageAnchor,
            bounds: RenderBounds,
            image: ConsoleImage,
            offset: ConsoleImageOffset,
            localToWorld: LocalToWorld,
            // position: LocalPosition
        }, {
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [RenderBounds]
        }).forEach(({bounds, localToWorld, image, anchor, offset}) => {
            const position = localToWorld.position;
            // base position after offset
            const px = position[0] + (offset?.x || 0);
            const py = position[1] + (offset?.y || 0);
            // const px = position.x + (offset?.x || 0);
            // const py = position.y + (offset?.y || 0);

            // parse anchor -> fractional anchor (0=left/top, 0.5=center/middle, 1=right/bottom)
            const [v, h] = anchor?.anchorPosition.split('-') as [
                    'top' | 'middle' | 'bottom',
                    'left' | 'center' | 'right'
            ] || ["middle", "center"];

            const ax = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;    // horizontal anchor
            const ay = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;     // vertical anchor

            // compute top-left corner from anchor; handle negative sizes robustly
            const x0 = px - ax * image.sizeX;
            const y0 = py - ay * image.sizeY;
            const x1 = x0 + image.sizeX;
            const y1 = y0 + image.sizeY;

            bounds.xMin = Math.min(x0, x1);
            bounds.xMax = Math.max(x0, x1);
            bounds.yMin = Math.min(y0, y1);
            bounds.yMax = Math.max(y0, y1);
        })
    }

}