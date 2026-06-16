import {Component} from "../core";

export class ConsoleCellRatio extends Component {
    private _vec: number = 2;

    get value(): number {
        return this._vec;
    }

    set value(value: number) {
        this._vec = value;
    }
}