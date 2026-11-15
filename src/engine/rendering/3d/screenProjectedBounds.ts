import {asFloat32Array} from "../../math/types/vec";
import type {ReadonlyVec16} from "../../math/types/vec";
import {MAT4_FLOATS, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../math/mat4Layout";
import {NEAR_PLANE_Z} from "./software/meshRasterizer";

const AABB_CORNERS = 8;
const MAX_X_CORNER_BIT = 1;
const MAX_Y_CORNER_BIT = 2;
const MAX_Z_CORNER_BIT = 4;
const HALF = 2;
const ORTHOGRAPHIC_PIXELS_PER_UNIT = 1;
const SQUARE_CELL_RATIO = 1;

export class ScreenProjectedBounds {
    public width = 0;
    public height = 0;

    private _view: Float32Array = new Float32Array(MAT4_FLOATS);
    private _focalLength: number | undefined;
    private _cellRatio = SQUARE_CELL_RATIO;
    private _screenWidth = 0;
    private _screenHeight = 0;

    public begin(view: ReadonlyVec16, focalLength: number | undefined, cellRatio: number, screenWidth: number, screenHeight: number): void {
        this._view = asFloat32Array(view);
        this._focalLength = focalLength;
        this._cellRatio = cellRatio;
        this._screenWidth = screenWidth;
        this._screenHeight = screenHeight;
    }

    public project(xMin: number, yMin: number, zMin: number, xMax: number, yMax: number, zMax: number): boolean {
        const m = this._view;
        const focalLength = this._focalLength, cellRatio = this._cellRatio;
        const width = this._screenWidth, height = this._screenHeight;
        const halfW = width / HALF, halfH = height / HALF;

        let anyInFront = false;
        let anyBehindNearPlane = false;
        let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;

        for (let corner = 0; corner < AABB_CORNERS; corner++) {
            const x = (corner & MAX_X_CORNER_BIT) === 0 ? xMin : xMax;
            const y = (corner & MAX_Y_CORNER_BIT) === 0 ? yMin : yMax;
            const z = (corner & MAX_Z_CORNER_BIT) === 0 ? zMin : zMax;

            const vx = m[0] * x + m[4] * y + m[8] * z + m[MAT4_TRANSLATION_X];
            const vy = m[1] * x + m[5] * y + m[9] * z + m[MAT4_TRANSLATION_Y];
            const vz = m[2] * x + m[6] * y + m[10] * z + m[MAT4_TRANSLATION_Z];

            let depth = vz;
            if (vz < NEAR_PLANE_Z) {
                anyBehindNearPlane = true;
                depth = NEAR_PLANE_Z;
            } else {
                anyInFront = true;
            }

            const ppu = focalLength !== undefined ? focalLength / depth : ORTHOGRAPHIC_PIXELS_PER_UNIT;
            const sx = halfW + vx * ppu * cellRatio;
            const sy = halfH - vy * ppu;
            if (sx < minX) minX = sx;
            if (sx > maxX) maxX = sx;
            if (sy < minY) minY = sy;
            if (sy > maxY) maxY = sy;
        }

        if (!anyInFront) return false;

        const left = minX > 0 ? minX : 0, right = maxX < width ? maxX : width;
        const top = minY > 0 ? minY : 0, bottom = maxY < height ? maxY : height;
        this.width = right > left ? right - left : 0;
        this.height = bottom > top ? bottom - top : 0;

        if (anyBehindNearPlane) return true;
        return maxX > 0 && minX < width && maxY > 0 && minY < height;
    }
}
