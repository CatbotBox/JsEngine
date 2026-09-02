import {Component} from "../core";

export class ConsoleCellRatio extends Component {
    private _ratio: number = 2;

    get value(): number {
        return this._ratio;
    }

    set value(value: number) {
        this._ratio = value;
    }
}