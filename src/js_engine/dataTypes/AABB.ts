export interface AABB {
    readonly xMin: number;
    readonly yMin: number;
    readonly zMin: number;
    readonly xMax: number;
    readonly yMax: number;
    readonly zMax: number;
}

export namespace AABB {
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
        return {
            xMin: Math.min(a.xMin, b.xMin), yMin: Math.min(a.yMin, b.yMin), zMin: Math.min(a.zMin, b.zMin),
            xMax: Math.max(a.xMax, b.xMax), yMax: Math.max(a.yMax, b.yMax), zMax: Math.max(a.zMax, b.zMax),
        };
    }

    export function inflate(b: AABB, factor: number): AABB {
        if (factor === 1) return b;
        const cx = (b.xMin + b.xMax) * 0.5;
        const cy = (b.yMin + b.yMax) * 0.5;
        const cz = (b.zMin + b.zMax) * 0.5;
        const hx = Math.max(0.5, (b.xMax - b.xMin) * 0.5 * factor);
        const hy = Math.max(0.5, (b.yMax - b.yMin) * 0.5 * factor);
        const hz = Math.max(0.5, (b.zMax - b.zMin) * 0.5 * factor);
        return {xMin: cx - hx, yMin: cy - hy, zMin: cz - hz, xMax: cx + hx, yMax: cy + hy, zMax: cz + hz};
    }
}