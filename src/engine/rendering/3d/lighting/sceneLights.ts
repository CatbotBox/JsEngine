import {Resource} from "../../../core";

export const LIGHT_KIND_DIRECTIONAL = 0;
export const LIGHT_KIND_POINT = 1;
export const LIGHT_KIND_SPOT = 2;
export const LIGHT_KIND_SPHERE = 3;
export const LIGHT_KIND_TUBE = 4;
export const LIGHT_KIND_RECT = 5;

export const RGB_CHANNELS = 3;
export const VEC3_FLOATS = 3;
export const HEMISPHERE_GRADIENT_FLOATS = 9;
export const HEMISPHERE_RED_OFFSET = 0;
export const HEMISPHERE_GREEN_OFFSET = 3;
export const HEMISPHERE_BLUE_OFFSET = 6;
export const SMALLEST_CONE_COSINE_SPAN = 1e-4;
export const DIRECTIONAL_LIGHTS_CAST_SHADOWS = true;
export const POSITIONAL_LIGHTS_CAST_SHADOWS = false;
export const LIGHT_CASTS_SHADOWS = 1;
export const LIGHT_CASTS_NO_SHADOWS = 0;

const INITIAL_CAPACITY = 8;
const HALF = 0.5;

export function coneScaleOf(coneCosInner: number, coneCosOuter: number): number {
    return 1 / Math.max(coneCosInner - coneCosOuter, SMALLEST_CONE_COSINE_SPAN);
}

export class SceneLights extends Resource {
    public count: number = 0;
    public hasAnyLight: boolean = false;
    public hasHemisphere: boolean = false;
    public readonly ambient: Float32Array = new Float32Array(RGB_CHANNELS);
    public readonly hemisphereGradient: Float32Array = new Float32Array(HEMISPHERE_GRADIENT_FLOATS);

    public kind: Uint8Array = new Uint8Array(INITIAL_CAPACITY);
    public position: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public direction: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public color: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public range: Float32Array = new Float32Array(INITIAL_CAPACITY);
    public axisX: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public axisY: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public extentX: Float32Array = new Float32Array(INITIAL_CAPACITY);
    public extentY: Float32Array = new Float32Array(INITIAL_CAPACITY);
    public radius: Float32Array = new Float32Array(INITIAL_CAPACITY);
    public coneCosInner: Float32Array = new Float32Array(INITIAL_CAPACITY);
    public coneCosOuter: Float32Array = new Float32Array(INITIAL_CAPACITY);
    public castsShadows: Uint8Array = new Uint8Array(INITIAL_CAPACITY);

    public get capacity(): number {
        return this.kind.length;
    }

    public beginGather(): void {
        this.count = 0;
        this.hasAnyLight = false;
        this.hasHemisphere = false;
        this.ambient.fill(0);
        this.hemisphereGradient.fill(0);
    }

    public addAmbient(r: number, g: number, b: number): void {
        this.hasAnyLight = true;
        this.ambient[0] += r;
        this.ambient[1] += g;
        this.ambient[2] += b;
    }

    public addHemisphere(upX: number, upY: number, upZ: number, skyR: number, skyG: number, skyB: number, groundR: number, groundG: number, groundB: number): void {
        this.addAmbient((skyR + groundR) * HALF, (skyG + groundG) * HALF, (skyB + groundB) * HALF);
        this.hasHemisphere = true;
        const invLength = 1 / (Math.hypot(upX, upY, upZ) || 1);
        const unitX = upX * invLength, unitY = upY * invLength, unitZ = upZ * invLength;
        const gradient = this.hemisphereGradient;
        addScaled(gradient, HEMISPHERE_RED_OFFSET, (skyR - groundR) * HALF, unitX, unitY, unitZ);
        addScaled(gradient, HEMISPHERE_GREEN_OFFSET, (skyG - groundG) * HALF, unitX, unitY, unitZ);
        addScaled(gradient, HEMISPHERE_BLUE_OFFSET, (skyB - groundB) * HALF, unitX, unitY, unitZ);
    }

    public addDirectional(dirX: number, dirY: number, dirZ: number, r: number, g: number, b: number, castsShadows: boolean = DIRECTIONAL_LIGHTS_CAST_SHADOWS): void {
        const index = this.claimSlot(LIGHT_KIND_DIRECTIONAL, castsShadows);
        writeUnit(this.direction, index * 3, dirX, dirY, dirZ);
        this.writeColor(index, r, g, b);
    }

    public addPoint(x: number, y: number, z: number, r: number, g: number, b: number, range: number, castsShadows: boolean = POSITIONAL_LIGHTS_CAST_SHADOWS): void {
        this.claimPositional(LIGHT_KIND_POINT, x, y, z, r, g, b, range, castsShadows);
    }

    public addSpot(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number, r: number, g: number, b: number, range: number, coneCosInner: number, coneCosOuter: number,
                   castsShadows: boolean = POSITIONAL_LIGHTS_CAST_SHADOWS): void {
        const index = this.claimPositional(LIGHT_KIND_SPOT, x, y, z, r, g, b, range, castsShadows);
        writeUnit(this.direction, index * 3, dirX, dirY, dirZ);
        this.coneCosInner[index] = coneCosInner;
        this.coneCosOuter[index] = coneCosOuter;
    }

    public addSphere(x: number, y: number, z: number, r: number, g: number, b: number, range: number, radius: number, castsShadows: boolean = POSITIONAL_LIGHTS_CAST_SHADOWS): void {
        const index = this.claimPositional(LIGHT_KIND_SPHERE, x, y, z, r, g, b, range, castsShadows);
        this.radius[index] = radius;
    }

    public addTube(x: number, y: number, z: number, axisX: number, axisY: number, axisZ: number, r: number, g: number, b: number, range: number, halfLength: number, radius: number,
                   castsShadows: boolean = POSITIONAL_LIGHTS_CAST_SHADOWS): void {
        const index = this.claimPositional(LIGHT_KIND_TUBE, x, y, z, r, g, b, range, castsShadows);
        writeUnit(this.axisX, index * 3, axisX, axisY, axisZ);
        this.extentX[index] = halfLength;
        this.radius[index] = radius;
    }

    public addRect(x: number, y: number, z: number, dirX: number, dirY: number, dirZ: number, widthAxisX: number, widthAxisY: number, widthAxisZ: number,
                   heightAxisX: number, heightAxisY: number, heightAxisZ: number, r: number, g: number, b: number, range: number, halfWidth: number, halfHeight: number,
                   castsShadows: boolean = POSITIONAL_LIGHTS_CAST_SHADOWS): void {
        const index = this.claimPositional(LIGHT_KIND_RECT, x, y, z, r, g, b, range, castsShadows);
        const offset = index * 3;
        writeUnit(this.direction, offset, dirX, dirY, dirZ);
        writeUnit(this.axisX, offset, widthAxisX, widthAxisY, widthAxisZ);
        writeUnit(this.axisY, offset, heightAxisX, heightAxisY, heightAxisZ);
        this.extentX[index] = halfWidth;
        this.extentY[index] = halfHeight;
    }

    private claimPositional(kind: number, x: number, y: number, z: number, r: number, g: number, b: number, range: number, castsShadows: boolean): number {
        const index = this.claimSlot(kind, castsShadows);
        const offset = index * 3;
        this.position[offset] = x;
        this.position[offset + 1] = y;
        this.position[offset + 2] = z;
        this.writeColor(index, r, g, b);
        this.range[index] = range;
        return index;
    }

    private writeColor(index: number, r: number, g: number, b: number): void {
        const offset = index * 3;
        this.color[offset] = r;
        this.color[offset + 1] = g;
        this.color[offset + 2] = b;
    }

    private claimSlot(kind: number, castsShadows: boolean): number {
        if (this.count === this.capacity) this.grow();
        const index = this.count++;
        this.kind[index] = kind;
        this.castsShadows[index] = castsShadows ? LIGHT_CASTS_SHADOWS : LIGHT_CASTS_NO_SHADOWS;
        this.hasAnyLight = true;
        return index;
    }

    private grow(): void {
        const newCapacity = this.capacity * 2;
        this.kind = growTypedArray(this.kind, new Uint8Array(newCapacity));
        this.position = growTypedArray(this.position, new Float32Array(newCapacity * 3));
        this.direction = growTypedArray(this.direction, new Float32Array(newCapacity * 3));
        this.color = growTypedArray(this.color, new Float32Array(newCapacity * 3));
        this.range = growTypedArray(this.range, new Float32Array(newCapacity));
        this.axisX = growTypedArray(this.axisX, new Float32Array(newCapacity * 3));
        this.axisY = growTypedArray(this.axisY, new Float32Array(newCapacity * 3));
        this.extentX = growTypedArray(this.extentX, new Float32Array(newCapacity));
        this.extentY = growTypedArray(this.extentY, new Float32Array(newCapacity));
        this.radius = growTypedArray(this.radius, new Float32Array(newCapacity));
        this.coneCosInner = growTypedArray(this.coneCosInner, new Float32Array(newCapacity));
        this.coneCosOuter = growTypedArray(this.coneCosOuter, new Float32Array(newCapacity));
        this.castsShadows = growTypedArray(this.castsShadows, new Uint8Array(newCapacity));
    }
}

function addScaled(out: Float32Array, offset: number, scale: number, x: number, y: number, z: number): void {
    out[offset] += scale * x;
    out[offset + 1] += scale * y;
    out[offset + 2] += scale * z;
}

function writeUnit(out: Float32Array, offset: number, x: number, y: number, z: number): void {
    const invLength = 1 / (Math.hypot(x, y, z) || 1);
    out[offset] = x * invLength;
    out[offset + 1] = y * invLength;
    out[offset + 2] = z * invLength;
}

function growTypedArray<T extends Uint8Array | Float32Array>(source: T, target: T): T {
    target.set(source as never);
    return target;
}
