import {DeepReadonly} from "../../util/tokenUtils";
import {Mesh} from "./mesh";

export class ViewSpaceMesh {
    public positions: Float64Array = new Float64Array(0);
    public normals: Float64Array = new Float64Array(0);
    public vertCount: number = 0;
    public hasNormals: boolean = false;
    public mesh: DeepReadonly<Mesh> | null = null;

    public transformFrom(mesh: DeepReadonly<Mesh>, modelView: Float32Array, normalMatrix: Float32Array | null): this {
        const vertCount = mesh.vertCount;
        this.mesh = mesh;
        const floatCount = vertCount * 3;
        if (this.positions.length < floatCount) {
            this.positions = new Float64Array(floatCount);
            this.normals = new Float64Array(floatCount);
        }
        this.vertCount = vertCount;
        this.transformPositions(mesh.vertices.raw, modelView, floatCount);
        this.hasNormals = normalMatrix !== null;
        if (normalMatrix !== null) this.transformNormals(mesh.normals.raw, normalMatrix, floatCount);
        return this;
    }

    private transformPositions(source: Float32Array, m: Float32Array, floatCount: number): void {
        const out = this.positions;
        const m0 = m[0], m4 = m[4], m8 = m[8], m12 = m[12];
        const m1 = m[1], m5 = m[5], m9 = m[9], m13 = m[13];
        const m2 = m[2], m6 = m[6], m10 = m[10], m14 = m[14];
        for (let j = 0; j < floatCount; j += 3) {
            const x = source[j], y = source[j + 1], z = source[j + 2];
            out[j] = m0 * x + m4 * y + m8 * z + m12;
            out[j + 1] = m1 * x + m5 * y + m9 * z + m13;
            out[j + 2] = m2 * x + m6 * y + m10 * z + m14;
        }
    }

    private transformNormals(source: Float32Array, n: Float32Array, floatCount: number): void {
        const out = this.normals;
        const n0 = n[0], n3 = n[3], n6 = n[6];
        const n1 = n[1], n4 = n[4], n7 = n[7];
        const n2 = n[2], n5 = n[5], n8 = n[8];
        for (let j = 0; j < floatCount; j += 3) {
            const x = source[j], y = source[j + 1], z = source[j + 2];
            const tx = n0 * x + n3 * y + n6 * z;
            const ty = n1 * x + n4 * y + n7 * z;
            const tz = n2 * x + n5 * y + n8 * z;
            const lengthSquared = tx * tx + ty * ty + tz * tz;
            const invLength = lengthSquared > 0 ? 1 / Math.sqrt(lengthSquared) : 0;
            out[j] = tx * invLength;
            out[j + 1] = ty * invLength;
            out[j + 2] = tz * invLength;
        }
    }
}
