import {DEFAULT_LIGHT_RANGE, RangedLight} from "./rangedLight";

const DEFAULT_INNER_CONE_ANGLE = 0.4;
const DEFAULT_OUTER_CONE_ANGLE = 0.8;
export const WIDEST_SPOT_CONE_ANGLE = 1.5707963267948966;

function coneAngleOf(radians: number): number {
    return Math.min(WIDEST_SPOT_CONE_ANGLE, Math.max(0, radians));
}

export class SpotLight extends RangedLight {
    private _innerConeAngle = DEFAULT_INNER_CONE_ANGLE;
    private _outerConeAngle = DEFAULT_OUTER_CONE_ANGLE;

    public constructor(range: number = DEFAULT_LIGHT_RANGE, innerConeAngle: number = DEFAULT_INNER_CONE_ANGLE, outerConeAngle: number = DEFAULT_OUTER_CONE_ANGLE, color?: number, intensity?: number) {
        super(range, color, intensity);
        this.innerConeAngle = innerConeAngle;
        this.outerConeAngle = outerConeAngle;
    }

    get innerConeAngle(): number {
        return this._innerConeAngle;
    }

    set innerConeAngle(radians: number) {
        this._innerConeAngle = coneAngleOf(radians);
    }

    get outerConeAngle(): number {
        return this._outerConeAngle;
    }

    set outerConeAngle(radians: number) {
        this._outerConeAngle = coneAngleOf(radians);
    }
}
