import {
    coneScaleOf,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
    VEC3_FLOATS,
} from "./sceneLights";
import type {SceneLights} from "./sceneLights";

export const AREA_LIGHT_WIDENING_DIVISOR = 3;
export const ROUGHNESS_FROM_SHININESS = 2;
export const SMALLEST_ROUGHNESS = 1e-4;
export const SMALLEST_LIGHT_DISTANCE = 1e-4;
export const SMALLEST_SEGMENT_RAY_SPREAD = 1e-6;
export const SMALLEST_RAY_PLANE_COSINE = 1e-3;

export const SHAPED_DIFFUSE = 0;
export const SHAPED_HIGHLIGHT_X = 1;
export const SHAPED_HIGHLIGHT_Y = 2;
export const SHAPED_HIGHLIGHT_Z = 3;
export const SHAPED_HIGHLIGHT_ATTENUATION = 4;
const SHAPED_RESULT_FLOATS = 5;

const REFLECTION_SCALE = 2;
const SMOOTHSTEP_SQUARE_COEFFICIENT = 3;
const SMOOTHSTEP_CUBE_COEFFICIENT = 2;

export function isShapedLightKind(kind: number): boolean {
    return kind === LIGHT_KIND_SPOT || kind === LIGHT_KIND_SPHERE || kind === LIGHT_KIND_TUBE || kind === LIGHT_KIND_RECT;
}

export function roughnessOfShininess(shininess: number): number {
    return Math.max(Math.sqrt(ROUGHNESS_FROM_SHININESS / (Math.max(shininess, 0) + ROUGHNESS_FROM_SHININESS)), SMALLEST_ROUGHNESS);
}

export function widenedRoughness(roughness: number, halfExtent: number, distance: number): number {
    return saturate(roughness + halfExtent / (AREA_LIGHT_WIDENING_DIVISOR * Math.max(distance, SMALLEST_LIGHT_DISTANCE)));
}

export function rangeFalloff(distanceSquared: number, rangeSquared: number): number {
    if (distanceSquared >= rangeSquared) return 0;
    const falloff = 1 - distanceSquared / rangeSquared;
    return falloff * falloff;
}

export function unitSmoothstep(value: number): number {
    const t = saturate(value);
    return t * t * (SMOOTHSTEP_SQUARE_COEFFICIENT - SMOOTHSTEP_CUBE_COEFFICIENT * t);
}

function saturate(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

function rotateInto(out: Float64Array, offset: number, view: Float32Array, source: Float32Array, sourceOffset: number): void {
    const x = source[sourceOffset], y = source[sourceOffset + 1], z = source[sourceOffset + 2];
    out[offset] = view[0] * x + view[4] * y + view[8] * z;
    out[offset + 1] = view[1] * x + view[5] * y + view[9] * z;
    out[offset + 2] = view[2] * x + view[6] * y + view[10] * z;
}

export class ShapedLights {
    public readonly result = new Float64Array(SHAPED_RESULT_FLOATS);
    private direction = new Float64Array(0);
    private axisX = new Float64Array(0);
    private axisY = new Float64Array(0);
    private extentX = new Float64Array(0);
    private extentY = new Float64Array(0);
    private radius = new Float64Array(0);
    private coneCosOuter = new Float64Array(0);
    private coneScale = new Float64Array(0);
    private readonly rectPoint = new Float64Array(VEC3_FLOATS);
    private px = 0;
    private py = 0;
    private pz = 0;
    private nx = 0;
    private ny = 0;
    private nz = 0;
    private specular = false;
    private reflectX = 0;
    private reflectY = 0;
    private reflectZ = 0;
    private roughness = 1;

    public reserve(count: number): void {
        if (this.radius.length >= count) return;
        this.direction = new Float64Array(count * VEC3_FLOATS);
        this.axisX = new Float64Array(count * VEC3_FLOATS);
        this.axisY = new Float64Array(count * VEC3_FLOATS);
        this.extentX = new Float64Array(count);
        this.extentY = new Float64Array(count);
        this.radius = new Float64Array(count);
        this.coneCosOuter = new Float64Array(count);
        this.coneScale = new Float64Array(count);
    }

    public load(sceneLights: SceneLights, index: number, view: Float32Array): void {
        const kind = sceneLights.kind[index];
        const offset = index * VEC3_FLOATS;
        if (kind === LIGHT_KIND_SPOT || kind === LIGHT_KIND_RECT) rotateInto(this.direction, offset, view, sceneLights.direction, offset);
        if (kind === LIGHT_KIND_SPOT) {
            this.coneCosOuter[index] = sceneLights.coneCosOuter[index];
            this.coneScale[index] = coneScaleOf(sceneLights.coneCosInner[index], sceneLights.coneCosOuter[index]);
        }
        if (kind === LIGHT_KIND_SPHERE) {
            this.axisX.fill(0, offset, offset + VEC3_FLOATS);
            this.extentX[index] = 0;
            this.radius[index] = sceneLights.radius[index];
        }
        if (kind === LIGHT_KIND_TUBE) {
            rotateInto(this.axisX, offset, view, sceneLights.axisX, offset);
            this.extentX[index] = sceneLights.extentX[index];
            this.radius[index] = sceneLights.radius[index];
        }
        if (kind === LIGHT_KIND_RECT) {
            rotateInto(this.axisX, offset, view, sceneLights.axisX, offset);
            rotateInto(this.axisY, offset, view, sceneLights.axisY, offset);
            this.extentX[index] = sceneLights.extentX[index];
            this.extentY[index] = sceneLights.extentY[index];
        }
    }

    public beginVertex(px: number, py: number, pz: number, nx: number, ny: number, nz: number, specular: boolean, viewX: number, viewY: number, viewZ: number, roughness: number): void {
        this.px = px;
        this.py = py;
        this.pz = pz;
        this.nx = nx;
        this.ny = ny;
        this.nz = nz;
        this.specular = specular;
        if (!specular) return;
        const twiceNormalDotView = REFLECTION_SCALE * (nx * viewX + ny * viewY + nz * viewZ);
        this.reflectX = twiceNormalDotView * nx - viewX;
        this.reflectY = twiceNormalDotView * ny - viewY;
        this.reflectZ = twiceNormalDotView * nz - viewZ;
        this.roughness = roughness;
    }

    public shade(kind: number, index: number, lightX: number, lightY: number, lightZ: number, rangeSquared: number): boolean {
        if (kind === LIGHT_KIND_SPOT) return this.shadeSpot(index, lightX, lightY, lightZ, rangeSquared);
        if (kind === LIGHT_KIND_RECT) return this.shadeRect(index, lightX, lightY, lightZ, rangeSquared);
        return this.shadeCapsule(index, lightX, lightY, lightZ, rangeSquared);
    }

    private shadeSpot(index: number, lightX: number, lightY: number, lightZ: number, rangeSquared: number): boolean {
        const dx = lightX - this.px, dy = lightY - this.py, dz = lightZ - this.pz;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= rangeSquared || distanceSquared === 0) return false;
        const falloff = 1 - distanceSquared / rangeSquared;
        const distance = Math.sqrt(distanceSquared);
        const toX = dx / distance, toY = dy / distance, toZ = dz / distance;
        const offset = index * VEC3_FLOATS;
        const alongCone = -(toX * this.direction[offset] + toY * this.direction[offset + 1] + toZ * this.direction[offset + 2]);
        const attenuation = falloff * falloff * unitSmoothstep((alongCone - this.coneCosOuter[index]) * this.coneScale[index]);
        this.writeDiffuse(toX, toY, toZ, attenuation);
        this.writeHighlight(toX, toY, toZ, toX, toY, toZ, attenuation);
        return true;
    }

    private shadeCapsule(index: number, centreX: number, centreY: number, centreZ: number, rangeSquared: number): boolean {
        const offset = index * VEC3_FLOATS;
        const axisX = this.axisX[offset], axisY = this.axisX[offset + 1], axisZ = this.axisX[offset + 2];
        const halfLength = this.extentX[index];
        const radius = this.radius[index];
        const toCentreX = centreX - this.px, toCentreY = centreY - this.py, toCentreZ = centreZ - this.pz;
        const along = clamp(-(toCentreX * axisX + toCentreY * axisY + toCentreZ * axisZ), -halfLength, halfLength);
        const toCoreX = toCentreX + axisX * along, toCoreY = toCentreY + axisY * along, toCoreZ = toCentreZ + axisZ * along;
        const coreDistanceSquared = toCoreX * toCoreX + toCoreY * toCoreY + toCoreZ * toCoreZ;
        if (coreDistanceSquared === 0) return false;
        const coreDistance = Math.sqrt(coreDistanceSquared);
        const surfaceDistance = Math.max(coreDistance - radius, 0);
        const attenuation = rangeFalloff(surfaceDistance * surfaceDistance, rangeSquared);
        const toX = toCoreX / coreDistance, toY = toCoreY / coreDistance, toZ = toCoreZ / coreDistance;
        if (!this.writeDiffuse(toX, toY, toZ, attenuation)) return true;

        const rx = this.reflectX, ry = this.reflectY, rz = this.reflectZ;
        const startX = toCentreX - axisX * halfLength, startY = toCentreY - axisY * halfLength, startZ = toCentreZ - axisZ * halfLength;
        const spanX = toCentreX + axisX * halfLength - startX, spanY = toCentreY + axisY * halfLength - startY, spanZ = toCentreZ + axisZ * halfLength - startZ;
        const reflectionDotStart = rx * startX + ry * startY + rz * startZ;
        const reflectionDotSpan = rx * spanX + ry * spanY + rz * spanZ;
        const startDotSpan = startX * spanX + startY * spanY + startZ * spanZ;
        const spread = Math.max(spanX * spanX + spanY * spanY + spanZ * spanZ - reflectionDotSpan * reflectionDotSpan, SMALLEST_SEGMENT_RAY_SPREAD);
        const t = saturate((reflectionDotStart * reflectionDotSpan - startDotSpan) / spread);
        let pointX = startX + spanX * t, pointY = startY + spanY * t, pointZ = startZ + spanZ * t;
        const pointDotReflection = pointX * rx + pointY * ry + pointZ * rz;
        const centreToRayX = pointDotReflection * rx - pointX, centreToRayY = pointDotReflection * ry - pointY, centreToRayZ = pointDotReflection * rz - pointZ;
        const centreToRayLengthSquared = centreToRayX * centreToRayX + centreToRayY * centreToRayY + centreToRayZ * centreToRayZ;
        if (centreToRayLengthSquared > 0) {
            const reach = saturate(radius / Math.sqrt(centreToRayLengthSquared));
            pointX += centreToRayX * reach;
            pointY += centreToRayY * reach;
            pointZ += centreToRayZ * reach;
        }
        const centreDistance = Math.sqrt(toCentreX * toCentreX + toCentreY * toCentreY + toCentreZ * toCentreZ);
        const roughness = this.roughness;
        const radiusRatio = roughness / widenedRoughness(roughness, radius, centreDistance);
        const lengthRatio = roughness / widenedRoughness(roughness, halfLength, centreDistance);
        this.writeHighlight(pointX, pointY, pointZ, toX, toY, toZ, attenuation * radiusRatio * radiusRatio * lengthRatio);
        return true;
    }

    private shadeRect(index: number, centreX: number, centreY: number, centreZ: number, rangeSquared: number): boolean {
        const offset = index * VEC3_FLOATS;
        const normalX = this.direction[offset], normalY = this.direction[offset + 1], normalZ = this.direction[offset + 2];
        const fromCentreX = this.px - centreX, fromCentreY = this.py - centreY, fromCentreZ = this.pz - centreZ;
        const height = fromCentreX * normalX + fromCentreY * normalY + fromCentreZ * normalZ;
        if (height <= 0) return false;
        const point = this.rectPoint;
        this.closestRectPoint(index, fromCentreX, fromCentreY, fromCentreZ);
        const toClosestX = point[0] - fromCentreX, toClosestY = point[1] - fromCentreY, toClosestZ = point[2] - fromCentreZ;
        const distanceSquared = toClosestX * toClosestX + toClosestY * toClosestY + toClosestZ * toClosestZ;
        if (distanceSquared === 0) return false;
        const distance = Math.sqrt(distanceSquared);
        const toX = toClosestX / distance, toY = toClosestY / distance, toZ = toClosestZ / distance;
        const emitterCosine = Math.max(-(toX * normalX + toY * normalY + toZ * normalZ), 0);
        const attenuation = rangeFalloff(distanceSquared, rangeSquared) * emitterCosine;
        if (!this.writeDiffuse(toX, toY, toZ, attenuation)) return true;

        const rx = this.reflectX, ry = this.reflectY, rz = this.reflectZ;
        const reach = height / Math.max(-(rx * normalX + ry * normalY + rz * normalZ), SMALLEST_RAY_PLANE_COSINE);
        this.closestRectPoint(index, fromCentreX + rx * reach, fromCentreY + ry * reach, fromCentreZ + rz * reach);
        const centreDistance = Math.sqrt(fromCentreX * fromCentreX + fromCentreY * fromCentreY + fromCentreZ * fromCentreZ);
        const roughness = this.roughness;
        const widthRatio = roughness / widenedRoughness(roughness, this.extentX[index], centreDistance);
        const heightRatio = roughness / widenedRoughness(roughness, this.extentY[index], centreDistance);
        this.writeHighlight(point[0] - fromCentreX, point[1] - fromCentreY, point[2] - fromCentreZ, toX, toY, toZ, attenuation * widthRatio * heightRatio);
        return true;
    }

    private closestRectPoint(index: number, fromCentreX: number, fromCentreY: number, fromCentreZ: number): void {
        const offset = index * VEC3_FLOATS;
        const widthX = this.axisX[offset], widthY = this.axisX[offset + 1], widthZ = this.axisX[offset + 2];
        const heightX = this.axisY[offset], heightY = this.axisY[offset + 1], heightZ = this.axisY[offset + 2];
        const halfWidth = this.extentX[index], halfHeight = this.extentY[index];
        const across = clamp(fromCentreX * widthX + fromCentreY * widthY + fromCentreZ * widthZ, -halfWidth, halfWidth);
        const up = clamp(fromCentreX * heightX + fromCentreY * heightY + fromCentreZ * heightZ, -halfHeight, halfHeight);
        const point = this.rectPoint;
        point[0] = widthX * across + heightX * up;
        point[1] = widthY * across + heightY * up;
        point[2] = widthZ * across + heightZ * up;
    }

    private writeDiffuse(toX: number, toY: number, toZ: number, attenuation: number): boolean {
        const diffuse = (this.nx * toX + this.ny * toY + this.nz * toZ) * attenuation;
        this.result[SHAPED_DIFFUSE] = diffuse;
        return this.specular && diffuse > 0;
    }

    private writeHighlight(x: number, y: number, z: number, fallbackX: number, fallbackY: number, fallbackZ: number, attenuation: number): void {
        const result = this.result;
        const lengthSquared = x * x + y * y + z * z;
        if (lengthSquared > 0) {
            const length = Math.sqrt(lengthSquared);
            result[SHAPED_HIGHLIGHT_X] = x / length;
            result[SHAPED_HIGHLIGHT_Y] = y / length;
            result[SHAPED_HIGHLIGHT_Z] = z / length;
        } else {
            result[SHAPED_HIGHLIGHT_X] = fallbackX;
            result[SHAPED_HIGHLIGHT_Y] = fallbackY;
            result[SHAPED_HIGHLIGHT_Z] = fallbackZ;
        }
        result[SHAPED_HIGHLIGHT_ATTENUATION] = attenuation;
    }
}
