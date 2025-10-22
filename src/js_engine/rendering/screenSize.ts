import {Component} from "../core";
import {Vec2} from "../math/types/vec";

export class ScreenSize extends Component {
    private _vec: Vec2 = [0, 0]
    get vec(): Vec2 {
        return this._vec;
    }

    set vec(value: Vec2) {
        this._vec = value;
    }

    get x(): number {
        return this._vec[0];
    }

    set x(value: number) {
        this._vec[0] = value;
    }

    get y(): number {
        return this._vec[1];
    }

    set y(value: number) {
        this._vec[1] = value;
    }
}