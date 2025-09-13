import {System} from "../../../core";
import {ConsoleImageAnchor, ConsoleImageOffset} from "./components";
import {Size2d} from "../size2d";
import {Bounds2d} from "../bounds2d";
import {Position2d} from "../position2d";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";

export class ConsoleBoundsComputeSystem extends System {
    private _query = this.createEntityQuery([Position2d, Size2d, Bounds2d])
    override updateGroup() {
        return RenderingSystemGroup;
    }

    override updatePriority(): number {
        return -10;
    }
    protected onCreate() {
        this.requireForUpdate(this._query);
    }

    onUpdate() {
        this._query.stream({
            position: Position2d,
            anchor: ConsoleImageAnchor,
            offset: ConsoleImageOffset,
            size: Size2d,
            bounds: Bounds2d,
        }).forEach(({bounds, position, size, anchor, offset}) => {
            // base position after offset
            const px = position.x + (offset?.x || 0);
            const py = position.y + (offset?.y || 0);

            // parse anchor -> fractional anchor (0=left/top, 0.5=center/middle, 1=right/bottom)
            const [v, h] = anchor?.anchorPosition.split('-') as [
                    'top' | 'middle' | 'bottom',
                    'left' | 'center' | 'right'
            ] || ["middle", "center"];

            const ax = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;    // horizontal anchor
            const ay = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;     // vertical anchor

            // compute top-left corner from anchor; handle negative sizes robustly
            const x0 = px - ax * size.x;
            const y0 = py - ay * size.y;
            const x1 = x0 + size.x;
            const y1 = y0 + size.y;

            bounds.xMin = Math.min(x0, x1);
            bounds.xMax = Math.max(x0, x1);
            bounds.yMin = Math.min(y0, y1);
            bounds.yMax = Math.max(y0, y1);
        })
    }

}