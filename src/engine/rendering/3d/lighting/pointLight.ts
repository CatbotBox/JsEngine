import {DEFAULT_LIGHT_RANGE, RangedLight} from "./rangedLight";

export class PointLight extends RangedLight {
    public constructor(range: number = DEFAULT_LIGHT_RANGE, color?: number, intensity?: number) {
        super(range, color, intensity);
    }
}
