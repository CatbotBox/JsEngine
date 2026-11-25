import {DEFAULT_LIGHT_RANGE, RangedLight} from "./rangedLight";

const DEFAULT_TUBE_LENGTH = 2;
const DEFAULT_TUBE_RADIUS = 0.05;

export class TubeAreaLight extends RangedLight {
    private _length = DEFAULT_TUBE_LENGTH;
    private _radius = DEFAULT_TUBE_RADIUS;

    public constructor(range: number = DEFAULT_LIGHT_RANGE, length: number = DEFAULT_TUBE_LENGTH, radius: number = DEFAULT_TUBE_RADIUS, color?: number, intensity?: number) {
        super(range, color, intensity);
        this.length = length;
        this.radius = radius;
    }

    get length(): number {
        return this._length;
    }

    set length(value: number) {
        this._length = Math.max(0, value);
    }

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        this._radius = Math.max(0, value);
    }
}
