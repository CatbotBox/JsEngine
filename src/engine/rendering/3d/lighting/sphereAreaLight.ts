import {DEFAULT_LIGHT_RANGE, RangedLight} from "./rangedLight";

const DEFAULT_SPHERE_RADIUS = 0.25;

export class SphereAreaLight extends RangedLight {
    private _radius = DEFAULT_SPHERE_RADIUS;

    public constructor(range: number = DEFAULT_LIGHT_RANGE, radius: number = DEFAULT_SPHERE_RADIUS, color?: number, intensity?: number) {
        super(range, color, intensity);
        this.radius = radius;
    }

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        this._radius = Math.max(0, value);
    }
}
