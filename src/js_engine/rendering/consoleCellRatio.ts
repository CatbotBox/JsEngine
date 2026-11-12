import {Component} from "../core";

const DEFAULT_CELL_HEIGHT_PER_WIDTH = 2;

export class ConsoleCellRatio extends Component {
    private _ratio: number = DEFAULT_CELL_HEIGHT_PER_WIDTH;

    get value(): number {
        return this._ratio;
    }

    set value(value: number) {
        this._ratio = value;
    }
}