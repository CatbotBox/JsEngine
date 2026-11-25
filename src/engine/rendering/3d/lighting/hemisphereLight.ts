import {BLACK_RGB, PACKED_RGB_MASK, WHITE_RGB} from "../../packedRgb";
import {Light, writeScaledPackedRgb} from "./light";

const DEFAULT_HEMISPHERE_INTENSITY = 0.2;

export class HemisphereLight extends Light {
    private _groundColor: number = BLACK_RGB;

    public constructor(skyColor: number = WHITE_RGB, groundColor: number = BLACK_RGB, intensity: number = DEFAULT_HEMISPHERE_INTENSITY) {
        super(skyColor, intensity);
        this.groundColor = groundColor;
    }

    get skyColor(): number {
        return this.color;
    }

    set skyColor(packedRgb: number) {
        this.color = packedRgb;
    }

    get groundColor(): number {
        return this._groundColor;
    }

    set groundColor(packedRgb: number) {
        this._groundColor = packedRgb & PACKED_RGB_MASK;
    }

    public writeScaledGroundRgb(out: Float32Array, offset: number): void {
        writeScaledPackedRgb(this._groundColor, this.intensity, out, offset);
    }
}
