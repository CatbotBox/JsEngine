import {Component} from "../../../core";

export abstract class Light extends Component {
    protected constructor(private _color: number = 0xFFFFFF, private _intensity: number = 1) {
        super();
        this.color = _color;
        this.intensity = _intensity;
    }

    get color(): number {
        return this._color;
    }

    set color(packedRgb: number) {
        this._color = packedRgb & 0xFFFFFF;
    }

    get intensity(): number {
        return this._intensity;
    }

    set intensity(value: number) {
        this._intensity = Math.max(0, value);
    }

    public writeScaledRgb(out: Float32Array, offset: number): void {
        const scale = this._intensity / 255;
        out[offset] = ((this._color >> 16) & 255) * scale;
        out[offset + 1] = ((this._color >> 8) & 255) * scale;
        out[offset + 2] = (this._color & 255) * scale;
    }
}
