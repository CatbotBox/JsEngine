import {System} from "../../../core";
import {ConsoleImageAnchor, ConsoleImageOffset} from "./components";
import {Scale} from "../../../translation/scale";
import {Bounds} from "../../../translation/bounds";
import {Position} from "../../../translation/position";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";

export class ConsoleBoundsComputeSystem extends System {
    private _query = this.createEntityQuery([Position, Scale, Bounds])
    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return -10;
    }
    protected onCreate() {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate() {
        this._query.stream({
            position: Position,
            anchor: ConsoleImageAnchor,
            offset: ConsoleImageOffset,
            scale: Scale,
            bounds: Bounds,
        }).forEach(({bounds, position, scale, anchor, offset}) => {
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
            const x0 = px - ax * scale.x;
            const y0 = py - ay * scale.y;
            const x1 = x0 + scale.x;
            const y1 = y0 + scale.y;

            bounds.xMin = Math.min(x0, x1);
            bounds.xMax = Math.max(x0, x1);
            bounds.yMin = Math.min(y0, y1);
            bounds.yMax = Math.max(y0, y1);
        })
    }

}