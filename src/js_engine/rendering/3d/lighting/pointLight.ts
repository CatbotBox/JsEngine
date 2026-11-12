import {Light} from "./light";

const DEFAULT_RANGE = 10;

export class PointLight extends Light {
    private _range: number = DEFAULT_RANGE;

    public constructor(range: number = DEFAULT_RANGE, color?: number, intensity?: number) {
        super(color, intensity);
        this.range = range;
    }

    get range(): number {
        return this._range;
    }

    set range(value: number) {
        this._range = Math.max(0, value);
    }
}
