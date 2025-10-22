import {Component, Entity} from "../core";

import {AABB} from "../datatypes/AABB";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";
import {Vec3} from "../math/types/vec";

export class RenderBounds extends Component implements AABB {
    private _values: Float32Array = new Float32Array(6);

    setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new WorldSpaceRenderBounds())
    }

    get xMin(): number {
        return this._values[0];
    }

    set xMin(value: number) {
        this._values[0] = value;
    }

    get yMin(): number {
        return this._values[1];
    }

    set yMin(value: number) {
        this._values[1] = value;
    }

    get zMin(): number {
        return this._values[2];
    }

    set zMin(value: number) {
        this._values[2] = value;
    }

    get min(): Vec3 {
        return this._values.subarray(0, 3) as Vec3;
    }

    set min(value: Vec3) {
        this._values.set(value, 0)
    }


    get xMax(): number {
        return this._values[3];
    }

    set xMax(value: number) {
        this._values[3] = value;
    }

    get yMax(): number {
        return this._values[4];
    }

    set yMax(value: number) {
        this._values[4] = value;
    }

    get zMax(): number {
        return this._values[5];
    }

    set zMax(value: number) {
        this._values[5] = value;
    }

    get max(): Vec3 {
        return this._values.subarray(3, 6) as Vec3;
    }

    set max(value: Vec3) {
        this._values.set(value, 3)
    }


    protected copyTo(other: this) {
        other._values.set(this._values);
        return other;
    }
}


