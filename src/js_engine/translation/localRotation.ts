import {Component} from "../core";
import {asFloat32Array, fromFloat32Array, Vec, Vec4} from "../math/types/vec";
import type {F32Backed} from "../core/componentType";

export class LocalRotation extends Component implements F32Backed {
    static readonly f32Width = 4;

    private _values: Vec4 = Vec4.alloc();

    constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
        super();
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
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

    get w(): number {
        return Vec.w(this._values);
    }

    set w(value: number) {
        Vec.setW(this._values, value);
    }

    get xyzw(): Vec4 {
        return this._values;
    }

    set xyzw(value: Vec4) {
        Vec.copy(this._values, value);
    }

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(asFloat32Array(this._values), offset);
    }

    bindF32(src: Float32Array, offset: number): void {
        this._values = fromFloat32Array<4>(src.subarray(offset, offset + LocalRotation.f32Width));
    }

    detachF32(): void {
        const own = new Float32Array(LocalRotation.f32Width);
        own.set(asFloat32Array(this._values));
        this._values = fromFloat32Array<4>(own);
    }
}
