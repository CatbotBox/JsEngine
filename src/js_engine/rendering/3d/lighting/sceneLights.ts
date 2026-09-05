import {Resource} from "../../../core";

export const LIGHT_KIND_DIRECTIONAL = 0;
export const LIGHT_KIND_POINT = 1;

const INITIAL_CAPACITY = 8;

export class SceneLights extends Resource {
    public count: number = 0;
    public hasAnyLight: boolean = false;
    public readonly ambient: Float32Array = new Float32Array(3);

    public kind: Uint8Array = new Uint8Array(INITIAL_CAPACITY);
    public position: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public direction: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public color: Float32Array = new Float32Array(INITIAL_CAPACITY * 3);
    public range: Float32Array = new Float32Array(INITIAL_CAPACITY);

    public get capacity(): number {
        return this.kind.length;
    }

    public beginGather(): void {
        this.count = 0;
        this.hasAnyLight = false;
        this.ambient.fill(0);
    }

    public addAmbient(r: number, g: number, b: number): void {
        this.hasAnyLight = true;
        this.ambient[0] += r;
        this.ambient[1] += g;
        this.ambient[2] += b;
    }

    public addDirectional(dirX: number, dirY: number, dirZ: number, r: number, g: number, b: number): void {
        const index = this.claimSlot(LIGHT_KIND_DIRECTIONAL);
        const offset = index * 3;
        const invLength = 1 / (Math.hypot(dirX, dirY, dirZ) || 1);
        this.direction[offset] = dirX * invLength;
        this.direction[offset + 1] = dirY * invLength;
        this.direction[offset + 2] = dirZ * invLength;
        this.color[offset] = r;
        this.color[offset + 1] = g;
        this.color[offset + 2] = b;
    }

    public addPoint(x: number, y: number, z: number, r: number, g: number, b: number, range: number): void {
        const index = this.claimSlot(LIGHT_KIND_POINT);
        const offset = index * 3;
        this.position[offset] = x;
        this.position[offset + 1] = y;
        this.position[offset + 2] = z;
        this.color[offset] = r;
        this.color[offset + 1] = g;
        this.color[offset + 2] = b;
        this.range[index] = range;
    }

    private claimSlot(kind: number): number {
        if (this.count === this.capacity) this.grow();
        const index = this.count++;
        this.kind[index] = kind;
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
    }
}

function growTypedArray<T extends Uint8Array | Float32Array>(source: T, target: T): T {
    target.set(source as never);
    return target;
}
