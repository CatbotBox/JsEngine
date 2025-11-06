import {Vec3} from "../math/types/vec";

export interface AABB {
    readonly xMin: number;
    readonly yMin: number;
    readonly zMin: number;
    readonly xMax: number;
    readonly yMax: number;
    readonly zMax: number;

    readonly min: Vec3;
    readonly max: Vec3;
}

export namespace AABB {

    export function fromMinMax(min: Vec3, max: Vec3): Readonly<AABB> {
        return {
            min,
            max,
            xMin: min[0],
            xMax: max[0],
            yMin: min[1],
            yMax: max[1],
            zMin: min[2],
            zMax: max[2],
        }
    }

    export function fromExplicit(aabb: Omit<AABB, "min" | "max">): Readonly<AABB> {
        return {
            ...aabb,
            min:[aabb.xMin, aabb.yMin,aabb.zMin],
            max :[aabb.xMax, aabb.yMax,aabb.zMax],
        }
    }

    export function intersects(a: AABB, b: AABB): boolean {
        return !(
            b.xMax < a.xMin || b.xMin > a.xMax ||
            b.yMax < a.yMin || b.yMin > a.yMax ||
            b.zMax < a.zMin || b.zMin > a.zMax
        );
    }

    export function contains(a: AABB, b: AABB): boolean {
        return (
            b.xMin >= a.xMin && b.xMax <= a.xMax &&
            b.yMin >= a.yMin && b.yMax <= a.yMax &&
            b.zMin >= a.zMin && b.zMax <= a.zMax
        );
    }

    export function union(a: AABB, b: AABB): AABB {
        const xMin = Math.min(a.xMin, b.xMin);
        const yMin = Math.min(a.yMin, b.yMin);
        const zMin = Math.min(a.zMin, b.zMin);
        const xMax = Math.max(a.xMax, b.xMax);
        const yMax = Math.max(a.yMax, b.yMax);
        const zMax = Math.max(a.zMax, b.zMax);

        const min: Vec3 = [xMin, yMin, zMin];
        const max: Vec3 = [xMax, yMax, zMax];

        return {
            xMin, yMin, zMin,
            xMax, yMax, zMax,
            min, max
        }
    }

    export function inflate(b: AABB, factor: number): AABB {
        if (factor === 1) return b;
        const cx = (b.xMin + b.xMax) * 0.5;
        const cy = (b.yMin + b.yMax) * 0.5;
        const cz = (b.zMin + b.zMax) * 0.5;
        const hx = Math.max(0.5, (b.xMax - b.xMin) * 0.5 * factor);
        const hy = Math.max(0.5, (b.yMax - b.yMin) * 0.5 * factor);
        const hz = Math.max(0.5, (b.zMax - b.zMin) * 0.5 * factor);
        const xMin = cx - hx;
        const yMin = cy - hy;
        const zMin = cz - hz;
        const xMax = cx + hx;
        const yMax = cy + hy;
        const zMax = cz + hz;


        const min: Vec3 = [xMin, yMin, zMin];
        const max: Vec3 = [xMax, yMax, zMax];

        return {
            xMin, yMin, zMin,
            xMax, yMax, zMax,
            min, max
        }
    }
}