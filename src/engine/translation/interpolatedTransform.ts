import {Component} from "../core";
import type {F32Backed} from "../core/componentType";
import {MAT4_FLOATS} from "../math/mat4Layout";
import {
    TRS_FLOATS,
    TRS_POSITION_X,
    TRS_POSITION_Y,
    TRS_POSITION_Z,
    TRS_ROTATION_W,
    TRS_ROTATION_X,
    TRS_ROTATION_Y,
    TRS_ROTATION_Z,
    TRS_SCALE_X,
    TRS_SCALE_Y,
    TRS_SCALE_Z,
} from "../math/trsLayout";
import {LocalToWorld} from "./localToWorld";

const SCALAR_FLOATS = 1;
const PREVIOUS_TRS = 0;
const CURRENT_TRS = PREVIOUS_TRS + TRS_FLOATS;
const CURRENT_MATRIX = CURRENT_TRS + TRS_FLOATS;
const LAST_CAPTURED_TICK = CURRENT_MATRIX + MAT4_FLOATS;
const ENABLED = LAST_CAPTURED_TICK + SCALAR_FLOATS;
const BLENDED = ENABLED + SCALAR_FLOATS;
const INTERPOLATED_TRANSFORM_FLOATS = BLENDED + SCALAR_FLOATS;

const NO_CAPTURED_TICK = -1;
const F32_SIGNIFICAND_BITS = 24;
const F32_EXACT_INTEGER_LIMIT = 2 ** F32_SIGNIFICAND_BITS;
const ONE_TICK = 1;
const FLAG_SET = 1;
const FLAG_CLEAR = 0;
const ENABLED_BY_DEFAULT = true;
const NO_TICK_PROGRESS = 0;
const TICK_COMPLETE = 1;
const SAME_HEMISPHERE = 1;
const OPPOSITE_HEMISPHERE = -1;
const DEGENERATE_LENGTH = 0;

function capturedTickStamp(tickCount: number): number {
    return tickCount % F32_EXACT_INTEGER_LIMIT;
}

function previousTickStamp(tickCount: number): number {
    return (tickCount + F32_EXACT_INTEGER_LIMIT - ONE_TICK) % F32_EXACT_INTEGER_LIMIT;
}

function rangesEqual(a: Float32Array, aOff: number, b: Float32Array, bOff: number, length: number): boolean {
    for (let k = 0; k < length; k++) {
        if (a[aOff + k] !== b[bOff + k]) return false;
    }
    return true;
}

function copyRange(from: Float32Array, fromOff: number, to: Float32Array, toOff: number, length: number): void {
    for (let k = 0; k < length; k++) to[toOff + k] = from[fromOff + k];
}

export class InterpolatedTransform extends Component implements F32Backed {
    static readonly f32Width = INTERPOLATED_TRANSFORM_FLOATS;

    private _values: Float32Array = new Float32Array(INTERPOLATED_TRANSFORM_FLOATS);

    constructor(enabled: boolean = ENABLED_BY_DEFAULT) {
        super();
        this._values[LAST_CAPTURED_TICK] = NO_CAPTURED_TICK;
        this.enabled = enabled;
    }

    get enabled(): boolean {
        return this._values[ENABLED] === FLAG_SET;
    }

    set enabled(value: boolean) {
        this._values[ENABLED] = value ? FLAG_SET : FLAG_CLEAR;
    }

    public snap(): void {
        this._values[LAST_CAPTURED_TICK] = NO_CAPTURED_TICK;
    }

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(this._values, offset);
    }

    bindF32(rowView: Float32Array): void {
        this._values = rowView;
    }

    detachF32(): void {
        const own = new Float32Array(INTERPOLATED_TRANSFORM_FLOATS);
        own.set(this._values);
        this._values = own;
    }

    public static captureAt(values: Float32Array, v: number, localToWorld: Float32Array, m: number, tickCount: number, restart: boolean): void {
        const previous = v + PREVIOUS_TRS, current = v + CURRENT_TRS, currentMatrix = v + CURRENT_MATRIX;
        const continuous = !restart && values[v + LAST_CAPTURED_TICK] === previousTickStamp(tickCount);
        values[v + LAST_CAPTURED_TICK] = capturedTickStamp(tickCount);
        if (continuous) copyRange(values, current, values, previous, TRS_FLOATS);
        if (continuous && rangesEqual(localToWorld, m, values, currentMatrix, MAT4_FLOATS)) return;
        LocalToWorld.decomposeAt(localToWorld, m, values, current);
        copyRange(localToWorld, m, values, currentMatrix, MAT4_FLOATS);
        if (!continuous) copyRange(values, current, values, previous, TRS_FLOATS);
    }

    public static blendAt(values: Float32Array, v: number, localToWorld: Float32Array, m: number, tickCount: number, tickAlpha: number): boolean {
        if (values[v + ENABLED] !== FLAG_SET) return false;
        if (values[v + LAST_CAPTURED_TICK] !== capturedTickStamp(tickCount)) return false;
        if (Number.isNaN(tickAlpha) || tickAlpha >= TICK_COMPLETE) return false;
        if (rangesEqual(values, v + PREVIOUS_TRS, values, v + CURRENT_TRS, TRS_FLOATS)) return false;
        if (!rangesEqual(localToWorld, m, values, v + CURRENT_MATRIX, MAT4_FLOATS)) return false;
        InterpolatedTransform.blendTRSAt(values, v + PREVIOUS_TRS, values, v + CURRENT_TRS, Math.max(tickAlpha, NO_TICK_PROGRESS), localToWorld, m);
        values[v + BLENDED] = FLAG_SET;
        return true;
    }

    public static restoreAt(values: Float32Array, v: number, localToWorld: Float32Array, m: number): boolean {
        if (values[v + BLENDED] !== FLAG_SET) return false;
        copyRange(values, v + CURRENT_MATRIX, localToWorld, m, MAT4_FLOATS);
        values[v + BLENDED] = FLAG_CLEAR;
        return true;
    }

    public static blendTRSAt(
        from: Float32Array, fromOff: number,
        to: Float32Array, toOff: number,
        t: number,
        out: Float32Array, outOff: number,
    ): void {
        const keep = TICK_COMPLETE - t;
        const ax = from[fromOff + TRS_ROTATION_X], ay = from[fromOff + TRS_ROTATION_Y], az = from[fromOff + TRS_ROTATION_Z], aw = from[fromOff + TRS_ROTATION_W];
        const bx = to[toOff + TRS_ROTATION_X], by = to[toOff + TRS_ROTATION_Y], bz = to[toOff + TRS_ROTATION_Z], bw = to[toOff + TRS_ROTATION_W];
        const hemisphere = ax * bx + ay * by + az * bz + aw * bw < 0 ? OPPOSITE_HEMISPHERE : SAME_HEMISPHERE;
        const fromWeight = keep * hemisphere;
        let qx = ax * fromWeight + bx * t, qy = ay * fromWeight + by * t, qz = az * fromWeight + bz * t, qw = aw * fromWeight + bw * t;
        const length = Math.hypot(qx, qy, qz, qw);
        if (length === DEGENERATE_LENGTH) {
            qx = bx;
            qy = by;
            qz = bz;
            qw = bw;
        } else {
            qx /= length;
            qy /= length;
            qz /= length;
            qw /= length;
        }
        LocalToWorld.fromTRSAt(
            out, outOff,
            from[fromOff + TRS_POSITION_X] * keep + to[toOff + TRS_POSITION_X] * t,
            from[fromOff + TRS_POSITION_Y] * keep + to[toOff + TRS_POSITION_Y] * t,
            from[fromOff + TRS_POSITION_Z] * keep + to[toOff + TRS_POSITION_Z] * t,
            qx, qy, qz, qw,
            from[fromOff + TRS_SCALE_X] * keep + to[toOff + TRS_SCALE_X] * t,
            from[fromOff + TRS_SCALE_Y] * keep + to[toOff + TRS_SCALE_Y] * t,
            from[fromOff + TRS_SCALE_Z] * keep + to[toOff + TRS_SCALE_Z] * t,
        );
    }
}

export class InterpolatedTransformSnap extends Component {
}
