import {Component} from "../core";
import type {F32Backed} from "../core/componentType";

export const UI_RECT_X = 0;
export const UI_RECT_Y = 1;
export const UI_RECT_WIDTH = 2;
export const UI_RECT_HEIGHT = 3;
export const UI_RECT_CLIP_LEFT = 4;
export const UI_RECT_CLIP_TOP = 5;
export const UI_RECT_CLIP_RIGHT = 6;
export const UI_RECT_CLIP_BOTTOM = 7;
export const UI_RECT_FLOATS = 8;

export class UiRect extends Component implements F32Backed {
    static readonly f32Width = UI_RECT_FLOATS;

    private _values: Float32Array = new Float32Array(UI_RECT_FLOATS);

    get x(): number {
        return this._values[UI_RECT_X];
    }

    set x(value: number) {
        this._values[UI_RECT_X] = value;
    }

    get y(): number {
        return this._values[UI_RECT_Y];
    }

    set y(value: number) {
        this._values[UI_RECT_Y] = value;
    }

    get width(): number {
        return this._values[UI_RECT_WIDTH];
    }

    set width(value: number) {
        this._values[UI_RECT_WIDTH] = value;
    }

    get height(): number {
        return this._values[UI_RECT_HEIGHT];
    }

    set height(value: number) {
        this._values[UI_RECT_HEIGHT] = value;
    }

    get clipLeft(): number {
        return this._values[UI_RECT_CLIP_LEFT];
    }

    set clipLeft(value: number) {
        this._values[UI_RECT_CLIP_LEFT] = value;
    }

    get clipTop(): number {
        return this._values[UI_RECT_CLIP_TOP];
    }

    set clipTop(value: number) {
        this._values[UI_RECT_CLIP_TOP] = value;
    }

    get clipRight(): number {
        return this._values[UI_RECT_CLIP_RIGHT];
    }

    set clipRight(value: number) {
        this._values[UI_RECT_CLIP_RIGHT] = value;
    }

    get clipBottom(): number {
        return this._values[UI_RECT_CLIP_BOTTOM];
    }

    set clipBottom(value: number) {
        this._values[UI_RECT_CLIP_BOTTOM] = value;
    }

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(this._values, offset);
    }

    bindF32(rowView: Float32Array): void {
        this._values = rowView;
    }

    detachF32(): void {
        this._values = Float32Array.from(this._values);
    }
}
