import {Light} from "./light";
import {POSITIONAL_LIGHTS_CAST_SHADOWS} from "./sceneLights";

export const DEFAULT_LIGHT_RANGE = 10;

export abstract class RangedLight extends Light {
    public castsShadows: boolean = POSITIONAL_LIGHTS_CAST_SHADOWS;
    private _range: number = DEFAULT_LIGHT_RANGE;

    protected constructor(range: number = DEFAULT_LIGHT_RANGE, color?: number, intensity?: number) {
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
