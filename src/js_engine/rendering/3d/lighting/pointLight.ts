import {Light} from "./light";

export class PointLight extends Light {
    private _range: number = 10;

    public constructor(range: number = 10, color?: number, intensity?: number) {
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
