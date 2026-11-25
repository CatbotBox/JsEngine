import {Component} from "../../../core";
import {WHITE_RGB, PACKED_RGB_MASK, RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK, CHANNEL_MAX} from "../../packedRgb";


export abstract class Light extends Component {
    protected constructor(private _color: number = WHITE_RGB, private _intensity: number = 1) {
        super();
        this.color = _color;
        this.intensity = _intensity;
    }

    get color(): number {
        return this._color;
    }

    set color(packedRgb: number) {
        this._color = packedRgb & PACKED_RGB_MASK;
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._intensity = Math.max(0, value);
    }

    public writeScaledRgb(out: Float32Array, offset: number): void {
        writeScaledPackedRgb(this._color, this._intensity, out, offset);
    }
}

export function writeScaledPackedRgb(packedRgb: number, intensity: number, out: Float32Array, offset: number): void {
    const scale = intensity / CHANNEL_MAX;
    out[offset] = ((packedRgb >> RED_SHIFT) & CHANNEL_MASK) * scale;
    out[offset + 1] = ((packedRgb >> GREEN_SHIFT) & CHANNEL_MASK) * scale;
    out[offset + 2] = (packedRgb & CHANNEL_MASK) * scale;
}
