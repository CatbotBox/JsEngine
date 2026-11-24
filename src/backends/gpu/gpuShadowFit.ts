import {MAT4_ELEMENT, MAT4_FLOATS} from "../../engine/math/mat4Layout";
import {NEAR_PLANE_Z} from "../../engine/rendering/3d/software/meshRasterizer";

const HALF = 0.5;
const MAT4_SIDE = 4;
const ORTHOGRAPHIC_CAMERA_Z = 0;
const NDC_SPAN = 2;
const SNAP_MARGIN_TEXELS = 1;
const UP_REFERENCE_MAX_COSINE = 0.99;
const UNBOUNDED_CASTER_REACH_RADII = 1;
const NEAR_MARGIN_RADII = 0.01;
const AFFINE_W = 1;
const RADIUS_QUANTUM_BITS = 8;

export interface GpuShadowView {
    readonly cameraMatrix: ArrayLike<number>;
    readonly fieldOfViewRadians: number | undefined;
    readonly widthPx: number;
    readonly heightPx: number;
    readonly pixelHeightPerWidth: number;
    readonly orthographicDepthRange: number;
}

export class GpuShadowFit {
    public readonly worldToLightClip = new Float32Array(MAT4_FLOATS);
    public readonly viewToLightClip = new Float32Array(MAT4_FLOATS);
    public mapSize = 0;
    public radius = 0;
    public halfExtent = 0;
    public texelWorldSize = 0;
    public viewUnitsPerWorldUnit = 1;
    public sliceFarViewDepth = 0;
    public centerX = 0;
    public centerY = 0;
    public nearZ = 0;
    public farZ = 0;
    public casterWidthTexels = 0;
    public casterHeightTexels = 0;

    private readonly camera = new Float64Array(MAT4_FLOATS);
    private readonly worldToLight = new Float64Array(MAT4_FLOATS);
    private viewCenterDepth = 0;
    private sphereNearZ = 0;
    private rightX = 0;
    private rightY = 0;
    private rightZ = 0;
    private upX = 0;
    private upY = 0;
    private upZ = 0;
    private forwardX = 0;
    private forwardY = 0;
    private forwardZ = 0;

    public get depthRange(): number {
        return this.farZ - this.nearZ;
    }

    public fit(view: GpuShadowView, maxDistance: number, mapSize: number, directionX: number, directionY: number, directionZ: number): boolean {
        const directionLength = Math.hypot(directionX, directionY, directionZ);
        if (!(directionLength > 0) || !(mapSize > NDC_SPAN * SNAP_MARGIN_TEXELS) || !(view.widthPx > 0) || !(view.heightPx > 0)) return false;
        if (!this.fitViewSphere(view, maxDistance)) return false;
        const c = this.camera;
        c.set(view.cameraMatrix);
        const cameraScale = largestAxisScaleOf(c);
        if (!(cameraScale > 0) || !Number.isFinite(cameraScale)) return false;
        this.radius = stableRadiusOf(this.radius * cameraScale);
        this.viewUnitsPerWorldUnit = 1 / cameraScale;
        this.mapSize = mapSize;
        this.halfExtent = this.radius * mapSize / (mapSize - NDC_SPAN * SNAP_MARGIN_TEXELS);
        this.texelWorldSize = NDC_SPAN * this.halfExtent / mapSize;
        this.chooseLightBasis(directionX / directionLength, directionY / directionLength, directionZ / directionLength);

        const depth = this.viewCenterDepth;
        const worldX = c[MAT4_ELEMENT.m02] * depth + c[MAT4_ELEMENT.m03];
        const worldY = c[MAT4_ELEMENT.m12] * depth + c[MAT4_ELEMENT.m13];
        const worldZ = c[MAT4_ELEMENT.m22] * depth + c[MAT4_ELEMENT.m23];
        const texel = this.texelWorldSize;
        this.centerX = Math.round((this.rightX * worldX + this.rightY * worldY + this.rightZ * worldZ) / texel) * texel;
        this.centerY = Math.round((this.upX * worldX + this.upY * worldY + this.upZ * worldZ) / texel) * texel;
        const centerZ = this.forwardX * worldX + this.forwardY * worldY + this.forwardZ * worldZ;
        this.farZ = centerZ + this.radius;
        this.sphereNearZ = centerZ - this.radius;
        this.nearZ = this.sphereNearZ;
        return true;
    }

    public acceptsCaster(xMin: number, yMin: number, zMin: number, xMax: number, yMax: number, zMax: number): boolean {
        const x = (xMin + xMax) * HALF, y = (yMin + yMax) * HALF, z = (zMin + zMax) * HALF;
        const extentX = (xMax - xMin) * HALF, extentY = (yMax - yMin) * HALF, extentZ = (zMax - zMin) * HALF;
        const lightX = this.rightX * x + this.rightY * y + this.rightZ * z;
        const lightY = this.upX * x + this.upY * y + this.upZ * z;
        const lightZ = this.forwardX * x + this.forwardY * y + this.forwardZ * z;
        const halfX = Math.abs(this.rightX) * extentX + Math.abs(this.rightY) * extentY + Math.abs(this.rightZ) * extentZ;
        const halfY = Math.abs(this.upX) * extentX + Math.abs(this.upY) * extentY + Math.abs(this.upZ) * extentZ;
        const halfZ = Math.abs(this.forwardX) * extentX + Math.abs(this.forwardY) * extentY + Math.abs(this.forwardZ) * extentZ;
        const casterNearZ = lightZ - halfZ;
        const overlaps = Math.abs(lightX - this.centerX) <= this.halfExtent + halfX
            && Math.abs(lightY - this.centerY) <= this.halfExtent + halfY
            && casterNearZ <= this.farZ;
        if (!overlaps) return false;
        if (casterNearZ < this.nearZ && Number.isFinite(casterNearZ)) this.nearZ = casterNearZ;
        const mapSpan = NDC_SPAN * this.halfExtent;
        this.casterWidthTexels = Math.min(NDC_SPAN * halfX, mapSpan) / this.texelWorldSize;
        this.casterHeightTexels = Math.min(NDC_SPAN * halfY, mapSpan) / this.texelWorldSize;
        return true;
    }

    public finish(withUnboundedCasters: boolean): void {
        if (withUnboundedCasters) this.nearZ = Math.min(this.nearZ, this.sphereNearZ - this.radius * UNBOUNDED_CASTER_REACH_RADII);
        this.nearZ -= this.radius * NEAR_MARGIN_RADII;
        const lateral = 1 / this.halfExtent, depth = 1 / this.depthRange;
        const m = this.worldToLight;
        m.fill(0);
        m[MAT4_ELEMENT.m00] = this.rightX * lateral;
        m[MAT4_ELEMENT.m01] = this.rightY * lateral;
        m[MAT4_ELEMENT.m02] = this.rightZ * lateral;
        m[MAT4_ELEMENT.m03] = -this.centerX * lateral;
        m[MAT4_ELEMENT.m10] = this.upX * lateral;
        m[MAT4_ELEMENT.m11] = this.upY * lateral;
        m[MAT4_ELEMENT.m12] = this.upZ * lateral;
        m[MAT4_ELEMENT.m13] = -this.centerY * lateral;
        m[MAT4_ELEMENT.m20] = this.forwardX * depth;
        m[MAT4_ELEMENT.m21] = this.forwardY * depth;
        m[MAT4_ELEMENT.m22] = this.forwardZ * depth;
        m[MAT4_ELEMENT.m23] = -this.nearZ * depth;
        m[MAT4_ELEMENT.m33] = AFFINE_W;
        this.worldToLightClip.set(m);
        multiplyInto(this.viewToLightClip, m, this.camera);
    }

    private fitViewSphere(view: GpuShadowView, maxDistance: number): boolean {
        const fieldOfView = view.fieldOfViewRadians;
        let sliceNear: number, sliceFar: number, centerDepth: number, radius: number;
        if (fieldOfView !== undefined) {
            sliceNear = NEAR_PLANE_Z;
            sliceFar = maxDistance;
            const tanY = Math.tan(fieldOfView * HALF);
            const tanX = tanY * view.widthPx / (view.heightPx * view.pixelHeightPerWidth);
            const spread = Math.hypot(tanX, tanY);
            centerDepth = (sliceFar + sliceNear) * (1 + spread * spread) * HALF;
            if (centerDepth >= sliceFar) {
                centerDepth = sliceFar;
                radius = sliceFar * spread;
            } else {
                radius = Math.hypot(sliceFar - centerDepth, sliceFar * spread);
            }
        } else {
            sliceNear = ORTHOGRAPHIC_CAMERA_Z;
            sliceFar = Math.min(view.orthographicDepthRange, maxDistance);
            centerDepth = (sliceNear + sliceFar) * HALF;
            radius = Math.hypot(view.widthPx * HALF / view.pixelHeightPerWidth, view.heightPx * HALF, (sliceFar - sliceNear) * HALF);
        }
        if (!(sliceFar > sliceNear) || !Number.isFinite(sliceFar) || !(radius > 0) || !Number.isFinite(radius)) return false;
        this.sliceFarViewDepth = sliceFar;
        this.viewCenterDepth = centerDepth;
        this.radius = radius;
        return true;
    }

    private chooseLightBasis(forwardX: number, forwardY: number, forwardZ: number): void {
        const upReferenceIsY = Math.abs(forwardY) <= UP_REFERENCE_MAX_COSINE;
        const referenceY = upReferenceIsY ? 1 : 0, referenceZ = upReferenceIsY ? 0 : 1;
        let rightX = referenceY * forwardZ - referenceZ * forwardY;
        let rightY = referenceZ * forwardX;
        let rightZ = -referenceY * forwardX;
        const rightLength = Math.hypot(rightX, rightY, rightZ);
        rightX /= rightLength;
        rightY /= rightLength;
        rightZ /= rightLength;
        this.rightX = rightX;
        this.rightY = rightY;
        this.rightZ = rightZ;
        this.upX = forwardY * rightZ - forwardZ * rightY;
        this.upY = forwardZ * rightX - forwardX * rightZ;
        this.upZ = forwardX * rightY - forwardY * rightX;
        this.forwardX = forwardX;
        this.forwardY = forwardY;
        this.forwardZ = forwardZ;
    }
}

function stableRadiusOf(radius: number): number {
    const step = 2 ** (Math.floor(Math.log2(radius)) - RADIUS_QUANTUM_BITS);
    return Math.ceil(radius / step) * step;
}

function largestAxisScaleOf(m: Float64Array): number {
    return Math.max(
        Math.hypot(m[MAT4_ELEMENT.m00], m[MAT4_ELEMENT.m10], m[MAT4_ELEMENT.m20]),
        Math.hypot(m[MAT4_ELEMENT.m01], m[MAT4_ELEMENT.m11], m[MAT4_ELEMENT.m21]),
        Math.hypot(m[MAT4_ELEMENT.m02], m[MAT4_ELEMENT.m12], m[MAT4_ELEMENT.m22]),
    );
}

function multiplyInto(out: Float32Array, a: Float64Array, b: Float64Array): void {
    for (let column = 0; column < MAT4_SIDE; column++) {
        for (let row = 0; row < MAT4_SIDE; row++) {
            let sum = 0;
            for (let k = 0; k < MAT4_SIDE; k++) sum += a[k * MAT4_SIDE + row] * b[column * MAT4_SIDE + k];
            out[column * MAT4_SIDE + row] = sum;
        }
    }
}
