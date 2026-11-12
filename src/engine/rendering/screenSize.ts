import {Component} from "../core";
import {Vec, Vec2} from "../math/types/vec";

export class ScreenSize extends Component {
    private _values: Vec2 = Vec2.alloc();

    get xy(): Vec2 {
        return this._values;
    }

    set xy(value: Vec2) {
        Vec.copy(this._values, value);
    }

    get x(): number {
        return Vec.x(this._values);
    }

    set x(value: number) {
        Vec.setX(this._values, value);
    }

    get y(): number {
        return Vec.y(this._values);
    }

    set y(value: number) {
        Vec.setY(this._values, value);
    }
}
