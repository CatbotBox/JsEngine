import {Component} from "../core";
import {AABB} from "../datatypes/aabb";
import type {F32Backed} from "../core/componentType";
import {Vec, Vec3} from "../math/types/vec";

/**
 * Shared base for the components that are just an AABB in a column.
 *
 * RenderBounds and WorldSpaceRenderBounds were byte-identical apart from the former's
 * setup(), so the accessors live here once. None of this is on a hot path: the render
 * and bounds systems read the Float32 column directly through consumeSpans and never
 * touch these getters, which exist for setup code and tests.
 */
export abstract class AABBComponent extends Component implements F32Backed {
    /** SoA column width: the AABB's 6 floats live in the archetype's column. */
    static readonly f32Width = 6;

    protected _values: AABB = AABB.alloc();

    /** Live AABB view over this component's storage — same buffer, no copy. */
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

    // F32Backed (store-driven; see core/componentType.ts)

    writeF32(dst: Float32Array, offset: number): void {
        dst.set(AABB.asFloat32Array(this._values), offset);
    }

    bindF32(src: Float32Array, offset: number): void {
        this._values = AABB.wrap(src.subarray(offset, offset + 6));
    }

    detachF32(): void {
        const own = new Float32Array(6);
        own.set(AABB.asFloat32Array(this._values));
        this._values = AABB.wrap(own);
    }
}
