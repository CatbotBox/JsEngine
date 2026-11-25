import {DEFAULT_LIGHT_RANGE, RangedLight} from "./rangedLight";

const DEFAULT_RECT_WIDTH = 2;
const DEFAULT_RECT_HEIGHT = 1;

export class RectAreaLight extends RangedLight {
    private _width = DEFAULT_RECT_WIDTH;
    private _height = DEFAULT_RECT_HEIGHT;

    public constructor(range: number = DEFAULT_LIGHT_RANGE, width: number = DEFAULT_RECT_WIDTH, height: number = DEFAULT_RECT_HEIGHT, color?: number, intensity?: number) {
        super(range, color, intensity);
        this.width = width;
        this.height = height;
    }

    get width(): number {
        return this._width;
    }

    set width(value: number) {
        this._width = Math.max(0, value);
    }

    get height(): number {
        return this._height;
    }

    set height(value: number) {
        this._height = Math.max(0, value);
    }
}
