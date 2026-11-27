import {AXIS_X, AXIS_Y, axisArrays} from "./flexAxis";
import type {Axis, AxisArrays} from "./flexAxis";

const HIDDEN = 0;

export class FlexScrollbars {
    private _trackStart: AxisArrays = axisArrays(0);
    private _trackCross: AxisArrays = axisArrays(0);
    private _trackLength: AxisArrays = axisArrays(0);
    private _thumbStart: AxisArrays = axisArrays(0);
    private _thumbLength: AxisArrays = axisArrays(0);

    public get verticalTrackX(): Float64Array {
        return this._trackCross[AXIS_Y];
    }

    public get verticalTrackY(): Float64Array {
        return this._trackStart[AXIS_Y];
    }

    public get verticalTrackLength(): Float64Array {
        return this._trackLength[AXIS_Y];
    }

    public get verticalThumbStart(): Float64Array {
        return this._thumbStart[AXIS_Y];
    }

    public get verticalThumbLength(): Float64Array {
        return this._thumbLength[AXIS_Y];
    }

    public get horizontalTrackX(): Float64Array {
        return this._trackStart[AXIS_X];
    }

    public get horizontalTrackY(): Float64Array {
        return this._trackCross[AXIS_X];
    }

    public get horizontalTrackLength(): Float64Array {
        return this._trackLength[AXIS_X];
    }

    public get horizontalThumbStart(): Float64Array {
        return this._thumbStart[AXIS_X];
    }

    public get horizontalThumbLength(): Float64Array {
        return this._thumbLength[AXIS_X];
    }

    public allocate(capacity: number): void {
        this._trackStart = axisArrays(capacity);
        this._trackCross = axisArrays(capacity);
        this._trackLength = axisArrays(capacity);
        this._thumbStart = axisArrays(capacity);
        this._thumbLength = axisArrays(capacity);
    }

    public place(axis: Axis, node: number, trackStart: number, trackCross: number, trackLength: number, thumbStart: number, thumbLength: number): void {
        this._trackStart[axis][node] = trackStart;
        this._trackCross[axis][node] = trackCross;
        this._trackLength[axis][node] = trackLength;
        this._thumbStart[axis][node] = thumbStart;
        this._thumbLength[axis][node] = thumbLength;
    }

    public hide(axis: Axis, node: number): void {
        this.place(axis, node, HIDDEN, HIDDEN, HIDDEN, HIDDEN, HIDDEN);
    }
}
