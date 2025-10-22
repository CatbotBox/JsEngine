import {Component} from "../../core";

export class FieldOfView extends Component {
    private _radians: number = Math.PI / 3;

    get radians(): number {
        return this._radians;
    }

    set radians(value: number) {
        this._radians = value;
    }

    get degrees(): number {
        return this._radians * 180 / Math.PI;
    }

    set degrees(value: number) {
        this._radians = value * Math.PI / 180;
    }
}