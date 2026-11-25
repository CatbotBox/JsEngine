import {MAT4_ELEMENT, MAT4_FLOATS, MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {BASIS_FORWARD_OFFSET, BASIS_RIGHT_OFFSET, BASIS_UP_OFFSET, multiplyInto} from "./gpuShadowFit";
import {CUBE_FACES} from "./gpuShadowSettings";

const HALF = 0.5;
const NDC_SPAN = 2;
const CUBE_FACE_TAN_HALF_ANGLE = 1;

export const CUBE_FACE_POSITIVE_X = 0;
export const CUBE_FACE_NEGATIVE_X = 1;
export const CUBE_FACE_POSITIVE_Y = 2;
export const CUBE_FACE_NEGATIVE_Y = 3;
export const CUBE_FACE_POSITIVE_Z = 4;
export const CUBE_FACE_NEGATIVE_Z = 5;

export const CUBE_FACE_BASES: readonly (readonly number[])[] = [
    [0, 0, -1, 0, 1, 0, 1, 0, 0],
    [0, 0, 1, 0, 1, 0, -1, 0, 0],
    [1, 0, 0, 0, 0, -1, 0, 1, 0],
    [1, 0, 0, 0, 0, 1, 0, -1, 0],
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [-1, 0, 0, 0, 1, 0, 0, 0, -1],
];

export interface ShadowCasterView {
    readonly worldToLightClip: Float32Array;
    readonly casterWidthTexels: number;
    readonly casterHeightTexels: number;
    acceptsCaster(xMin: number, yMin: number, zMin: number, xMax: number, yMax: number, zMax: number): boolean;
}

function planeReaches(normalX: number, normalY: number, normalZ: number, centreX: number, centreY: number, centreZ: number,
    extentX: number, extentY: number, extentZ: number): boolean {
    return normalX * centreX + normalY * centreY + normalZ * centreZ
        + Math.abs(normalX) * extentX + Math.abs(normalY) * extentY + Math.abs(normalZ) * extentZ >= 0;
}

export class GpuShadowFrustum implements ShadowCasterView {
    public readonly worldToLightClip = new Float32Array(MAT4_FLOATS);
    public readonly viewToLightClip = new Float32Array(MAT4_FLOATS);
    public mapSize = 0;
    public tanHalfAngle = 0;
    public near = 0;
    public far = 0;
    public casterWidthTexels = 0;
    public casterHeightTexels = 0;

    private readonly worldToLight = new Float64Array(MAT4_FLOATS);
    private originX = 0;
    private originY = 0;
    private originZ = 0;
    private rightX = 0;
    private rightY = 0;
    private rightZ = 0;
    private upX = 0;
    private upY = 0;
    private upZ = 0;
    private forwardX = 0;
    private forwardY = 0;
    private forwardZ = 0;
    private emitterX = 0;
    private emitterY = 0;
    private emitterZ = 0;
    private culledBehindEmitter = false;

    public get depthScale(): number {
        return this.far / (this.far - this.near);
    }

    public get depthOffset(): number {
        return -this.far * this.near / (this.far - this.near);
    }

    public get texelSpread(): number {
        return NDC_SPAN * this.tanHalfAngle / this.mapSize;
    }

    public aim(originX: number, originY: number, originZ: number, basis: ArrayLike<number>, tanHalfAngle: number, near: number, far: number, mapSize: number): void {
        this.originX = originX;
        this.originY = originY;
        this.originZ = originZ;
        this.rightX = basis[BASIS_RIGHT_OFFSET];
        this.rightY = basis[BASIS_RIGHT_OFFSET + 1];
        this.rightZ = basis[BASIS_RIGHT_OFFSET + 2];
        this.upX = basis[BASIS_UP_OFFSET];
        this.upY = basis[BASIS_UP_OFFSET + 1];
        this.upZ = basis[BASIS_UP_OFFSET + 2];
        this.forwardX = basis[BASIS_FORWARD_OFFSET];
        this.forwardY = basis[BASIS_FORWARD_OFFSET + 1];
        this.forwardZ = basis[BASIS_FORWARD_OFFSET + 2];
        this.tanHalfAngle = tanHalfAngle;
        this.near = near;
        this.far = far;
        this.mapSize = mapSize;
        this.culledBehindEmitter = false;
        this.writeWorldToLight();
    }

    public cullBehind(normalX: number, normalY: number, normalZ: number): void {
        this.emitterX = normalX;
        this.emitterY = normalY;
        this.emitterZ = normalZ;
        this.culledBehindEmitter = true;
    }

    public finishView(camera: Float64Array): void {
        multiplyInto(this.viewToLightClip, this.worldToLight, camera);
    }

    public acceptsCaster(xMin: number, yMin: number, zMin: number, xMax: number, yMax: number, zMax: number): boolean {
        const x = (xMin + xMax) * HALF - this.originX, y = (yMin + yMax) * HALF - this.originY, z = (zMin + zMax) * HALF - this.originZ;
        const extentX = (xMax - xMin) * HALF, extentY = (yMax - yMin) * HALF, extentZ = (zMax - zMin) * HALF;
        const gapX = Math.max(Math.abs(x) - extentX, 0), gapY = Math.max(Math.abs(y) - extentY, 0), gapZ = Math.max(Math.abs(z) - extentZ, 0);
        const far = this.far;
        if (gapX * gapX + gapY * gapY + gapZ * gapZ > far * far) return false;
        if (this.culledBehindEmitter && !planeReaches(this.emitterX, this.emitterY, this.emitterZ, x, y, z, extentX, extentY, extentZ)) return false;
        const depth = this.forwardX * x + this.forwardY * y + this.forwardZ * z;
        const depthReach = Math.abs(this.forwardX) * extentX + Math.abs(this.forwardY) * extentY + Math.abs(this.forwardZ) * extentZ;
        if (depth + depthReach < this.near || depth - depthReach > far) return false;
        const t = this.tanHalfAngle;
        const tForwardX = t * this.forwardX, tForwardY = t * this.forwardY, tForwardZ = t * this.forwardZ;
        const inside = planeReaches(tForwardX - this.rightX, tForwardY - this.rightY, tForwardZ - this.rightZ, x, y, z, extentX, extentY, extentZ)
            && planeReaches(tForwardX + this.rightX, tForwardY + this.rightY, tForwardZ + this.rightZ, x, y, z, extentX, extentY, extentZ)
            && planeReaches(tForwardX - this.upX, tForwardY - this.upY, tForwardZ - this.upZ, x, y, z, extentX, extentY, extentZ)
            && planeReaches(tForwardX + this.upX, tForwardY + this.upY, tForwardZ + this.upZ, x, y, z, extentX, extentY, extentZ);
        if (!inside) return false;
        const across = Math.abs(this.rightX) * extentX + Math.abs(this.rightY) * extentY + Math.abs(this.rightZ) * extentZ;
        const along = Math.abs(this.upX) * extentX + Math.abs(this.upY) * extentY + Math.abs(this.upZ) * extentZ;
        const texelsPerUnit = this.mapSize / (NDC_SPAN * t * Math.max(depth, this.near));
        this.casterWidthTexels = Math.min(NDC_SPAN * across * texelsPerUnit, this.mapSize);
        this.casterHeightTexels = Math.min(NDC_SPAN * along * texelsPerUnit, this.mapSize);
        return true;
    }

    private writeWorldToLight(): void {
        const lateral = 1 / this.tanHalfAngle;
        const depthScale = this.depthScale;
        const toRight = this.rightX * this.originX + this.rightY * this.originY + this.rightZ * this.originZ;
        const toUp = this.upX * this.originX + this.upY * this.originY + this.upZ * this.originZ;
        const toForward = this.forwardX * this.originX + this.forwardY * this.originY + this.forwardZ * this.originZ;
        const m = this.worldToLight;
        m[MAT4_ELEMENT.m00] = this.rightX * lateral;
        m[MAT4_ELEMENT.m01] = this.rightY * lateral;
        m[MAT4_ELEMENT.m02] = this.rightZ * lateral;
        m[MAT4_ELEMENT.m03] = -toRight * lateral;
        m[MAT4_ELEMENT.m10] = this.upX * lateral;
        m[MAT4_ELEMENT.m11] = this.upY * lateral;
        m[MAT4_ELEMENT.m12] = this.upZ * lateral;
        m[MAT4_ELEMENT.m13] = -toUp * lateral;
        m[MAT4_ELEMENT.m20] = this.forwardX * depthScale;
        m[MAT4_ELEMENT.m21] = this.forwardY * depthScale;
        m[MAT4_ELEMENT.m22] = this.forwardZ * depthScale;
        m[MAT4_ELEMENT.m23] = -toForward * depthScale + this.depthOffset;
        m[MAT4_ELEMENT.m30] = this.forwardX;
        m[MAT4_ELEMENT.m31] = this.forwardY;
        m[MAT4_ELEMENT.m32] = this.forwardZ;
        m[MAT4_ELEMENT.m33] = -toForward;
        this.worldToLightClip.set(m);
    }
}

export class GpuShadowCube {
    public readonly faces: readonly GpuShadowFrustum[] = Array.from({length: CUBE_FACES}, () => new GpuShadowFrustum());
    public readonly viewToLightOffset = new Float32Array(MAT4_FLOATS);
    private originX = 0;
    private originY = 0;
    private originZ = 0;

    public get texelSpread(): number {
        return this.faces[CUBE_FACE_POSITIVE_X].texelSpread;
    }

    public get depthScale(): number {
        return this.faces[CUBE_FACE_POSITIVE_X].depthScale;
    }

    public get depthOffset(): number {
        return this.faces[CUBE_FACE_POSITIVE_X].depthOffset;
    }

    public aim(originX: number, originY: number, originZ: number, near: number, far: number, mapSize: number): void {
        this.originX = originX;
        this.originY = originY;
        this.originZ = originZ;
        for (let face = 0; face < CUBE_FACES; face++) this.faces[face].aim(originX, originY, originZ, CUBE_FACE_BASES[face], CUBE_FACE_TAN_HALF_ANGLE, near, far, mapSize);
    }

    public cullBehind(normalX: number, normalY: number, normalZ: number): void {
        for (const face of this.faces) face.cullBehind(normalX, normalY, normalZ);
    }

    public finishView(camera: Float64Array): void {
        const out = this.viewToLightOffset;
        for (let i = 0; i < MAT4_FLOATS; i++) out[i] = camera[i];
        out[MAT4_TRANSLATION_X] = camera[MAT4_TRANSLATION_X] - this.originX * camera[MAT4_ELEMENT.m33];
        out[MAT4_TRANSLATION_Y] = camera[MAT4_TRANSLATION_Y] - this.originY * camera[MAT4_ELEMENT.m33];
        out[MAT4_TRANSLATION_Z] = camera[MAT4_TRANSLATION_Z] - this.originZ * camera[MAT4_ELEMENT.m33];
    }
}
