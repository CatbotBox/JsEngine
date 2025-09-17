import {Component} from "../core";
import {Vec4} from "../math/types/vec";

export class LocalRotation extends Component {
    private _values = new Float32Array(4);

    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
    }

    get x(): number {
        return this._values[0];
    }

    set x(value: number) {
        this._values[0] = value;
    }

    get y(): number {
        return this._values[1];
    }

    set y(value: number) {
        this._values[1] = value;
    }

    get z(): number {
        return this._values[2];
    }

    set z(value: number) {
        this._values[2] = value;
    }

    get w(): number {
        return this._values[3];
    }

    set w(value: number) {
        this._values[3] = value;
    }

    get xyzw(): Vec4 {
        return this._values as Vec4;
    }

    set xyzw(value: Vec4) {
        this._values.set(value);
    }

    override copyTo(other: this) {
        other.xyzw = this.xyzw
        return other;
    }
}

// import {Component} from "../core";
//
// export class LocalRotation extends Component {
//     public w: number = 0;
//     public x: number = 0;
//     public y: number = 0;
//     public z: number = 0;
// }