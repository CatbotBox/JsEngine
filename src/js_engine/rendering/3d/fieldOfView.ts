import {Component} from "../../core";

const DEFAULT_FOV_RADIANS = Math.PI / 3;
const DEGREES_PER_PI_RADIANS = 180;

export class FieldOfView extends Component {
    private _radians: number = DEFAULT_FOV_RADIANS;

    get radians(): number {
        return this._radians;
    }

    set radians(value: number) {
        this._radians = value;
    }

    get degrees(): number {
        return this._radians * DEGREES_PER_PI_RADIANS / Math.PI;
    }

    set degrees(value: number) {
        this._radians = value * Math.PI / DEGREES_PER_PI_RADIANS;
    }
}