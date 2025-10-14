import {Component} from "../core";
import {AABB} from "../datatypes/AABB";
import {RenderBounds} from "./renderBounds";

export class WorldSpaceRenderBounds extends Component implements AABB {
    private _values: Float32Array = new Float32Array(6);

    get xMin(): number {
        return this._values[0];
    }

    set xMin(value: number) {
        this._values[0] = value;
    }

    get xMax(): number {
        return this._values[1];
    }

    set xMax(value: number) {
        this._values[1] = value;
    }

    get yMin(): number {
        return this._values[2];
    }

    set yMin(value: number) {
        this._values[2] = value;
    }

    get yMax(): number {
        return this._values[3];
    }

    set yMax(value: number) {
        this._values[3] = value;
    }

    get zMin(): number {
        return this._values[4];
    }

    set zMin(value: number) {
        this._values[4] = value;
    }

    get zMax(): number {
        return this._values[5];
    }

    set zMax(value: number) {
        this._values[5] = value;
    }

    protected copyTo(other: this) {
        other._values.set(this._values);
        return other;
    }
}