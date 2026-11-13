import {Component} from "../core";
import {asFloat32Array, fromFloat32Array, Vec, Vec3} from "../math/types/vec";
import type {F32Backed} from "../core/componentType";

export class LocalScale extends Component implements F32Backed {
    static readonly f32Width = 3;

    private _values: Vec3 = Vec3.alloc();

    constructor(x: number = 1, y: number = 1, z: number = 1) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
    }

    get x(): number {
        return Vec.x(this._values);
    }

    set x(value: number) {
        Vec.setX(this._values, value);
    }

    get y(): number {
        return Vec.y(this._values);
    }

    set y(value: number) {
        Vec.setY(this._values, value);
    }

    get z(): number {
        return Vec.z(this._values);
    }

    set z(value: number) {
        Vec.setZ(this._values, value);
    }

    get xyz(): Vec3 {
        return this._values;
    }

    set xyz(value: Vec3) {
        Vec.copy(this._values, value);
    }

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(asFloat32Array(this._values), offset);
    }

    bindF32(rowView: Float32Array): void {
        this._values = fromFloat32Array<3>(rowView);
    }

    detachF32(): void {
        const own = new Float32Array(LocalScale.f32Width);
        own.set(asFloat32Array(this._values));
        this._values = fromFloat32Array<3>(own);
    }
}
