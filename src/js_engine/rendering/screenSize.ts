import {Component} from "../core";
import {fromFloat32Array, Vec, Vec2} from "../math/types/vec";

export class ScreenSize extends Component {
    // Float32Array, not a plain array literal: `vec` hands this out as a Vec2 view,
    // so callers writing through it land here rather than in a detached copy.
    private _values = new Float32Array(2);

    get vec(): Vec2 {
        return fromFloat32Array<2>(this._values);
    }

    set vec(value: Vec2) {
        Vec.copy(this.vec, value);
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
}
