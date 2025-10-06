import {Component} from "../core";

import {AABB} from "../datatypes/AABB";

export class RenderBounds extends Component implements AABB {
    private _values: Float32Array = new Float32Array(6);

    get xMin(): number {
        return this._values[0];
    }

    set xMin(value: number) {
        this._values[0] = value;
    }

    get xMax(): number {
        return this._values[1];
    }

    set xMax(value: number) {
        this._values[1] = value;
    }

    get yMin(): number {
        return this._values[2];
    }

    set yMin(value: number) {
        this._values[2] = value;
    }

    get yMax(): number {
        return this._values[3];
    }

    set yMax(value: number) {
        this._values[3] = value;
    }

    get zMin(): number {
        return this._values[4];
    }

    set zMin(value: number) {
        this._values[4] = value;
    }

    get zMax(): number {
        return this._values[5];
    }

    set zMax(value: number) {
        this._values[5] = value;
    }

    public intersects(other: RenderBounds): boolean {
        return RenderBounds.intersects(this, other)
    }

    public static intersects(object1: RenderBounds, object2: RenderBounds): boolean {
        return !(
            object2.xMin > object1.xMax || object2.xMax < object1.xMin ||
            object2.yMin > object1.yMax || object2.yMax < object1.yMin ||
            object2.zMin < object1.zMin || object2.zMax < object1.zMin
        );
    }

    protected copyTo(other: this) {
        other._values.set(this._values);
        return other;
    }
}

//
// import {Component} from "../core";
//
// export class RenderBounds extends Component {
//     public xMin: number = 0;
//     public yMin: number = 0;
//
//     public xMax: number = 0;
//     public yMax: number = 0;
//
//     public zMin: number = 0;
//     public zMax: number = 0;
//
//     public intersects(other: RenderBounds): boolean {
//         return !(
//             other.xMin > this.xMax || other.xMax < this.xMin ||
//             other.yMin > this.yMax || other.yMax < this.yMin ||
//             other.zMin < this.zMin || other.zMax < this.zMin
//         );
//     }
// }