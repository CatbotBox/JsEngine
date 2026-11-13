import {Component} from "../core";
import {AABB, AABB_STRIDE} from "../datatypes/aabb";
import type {F32Backed} from "../core/componentType";
import {Vec, Vec3} from "../math/types/vec";

export abstract class AABBComponent extends Component implements F32Backed {
    static readonly f32Width = AABB_STRIDE;

    protected _values: AABB = AABB.alloc();

    get bounds(): AABB {
        return this._values;
    }

    get xMin(): number {
        return AABB.asFloat32Array(this._values)[0];
    }

    set xMin(value: number) {
        AABB.asFloat32Array(this._values)[0] = value;
    }

    get yMin(): number {
        return AABB.asFloat32Array(this._values)[1];
    }

    set yMin(value: number) {
        AABB.asFloat32Array(this._values)[1] = value;
    }

    get zMin(): number {
        return AABB.asFloat32Array(this._values)[2];
    }

    set zMin(value: number) {
        AABB.asFloat32Array(this._values)[2] = value;
    }

    get min(): Vec3 {
        return AABB.min(this._values);
    }

    set min(value: Vec3) {
        Vec.copy(AABB.min(this._values), value);
    }

    get xMax(): number {
        return AABB.asFloat32Array(this._values)[3];
    }

    set xMax(value: number) {
        AABB.asFloat32Array(this._values)[3] = value;
    }

    get yMax(): number {
        return AABB.asFloat32Array(this._values)[4];
    }

    set yMax(value: number) {
        AABB.asFloat32Array(this._values)[4] = value;
    }

    get zMax(): number {
        return AABB.asFloat32Array(this._values)[5];
    }

    set zMax(value: number) {
        AABB.asFloat32Array(this._values)[5] = value;
    }

    get max(): Vec3 {
        return AABB.max(this._values);
    }

    set max(value: Vec3) {
        Vec.copy(AABB.max(this._values), value);
    }

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(AABB.asFloat32Array(this._values), offset);
    }

    bindF32(rowView: Float32Array): void {
        this._values = AABB.wrap(rowView);
    }

    detachF32(): void {
        const own = new Float32Array(AABB_STRIDE);
        own.set(AABB.asFloat32Array(this._values));
        this._values = AABB.wrap(own);
    }
}
