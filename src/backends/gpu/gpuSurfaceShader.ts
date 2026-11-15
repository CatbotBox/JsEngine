import {Component} from "../../engine/core";

export const SURFACE_SHADER_PARAMS = 8;
export const LIT_SURFACE_SHADER = "lit";
export const NO_SURFACE_SHADER_PARAMS: ArrayLike<number> = new Float32Array(SURFACE_SHADER_PARAMS);

const NO_PARAMS: readonly number[] = [];

export class GpuSurfaceShader extends Component {
    public readonly params = new Float32Array(SURFACE_SHADER_PARAMS);

    public constructor(public name: string = LIT_SURFACE_SHADER, params: ArrayLike<number> = NO_PARAMS) {
        super();
        this.params.set(params);
    }

    public get param0(): number {
        return this.params[0];
    }

    public set param0(value: number) {
        this.params[0] = value;
    }

    public get param1(): number {
        return this.params[1];
    }

    public set param1(value: number) {
        this.params[1] = value;
    }

    public get param2(): number {
        return this.params[2];
    }

    public set param2(value: number) {
        this.params[2] = value;
    }

    public get param3(): number {
        return this.params[3];
    }

    public set param3(value: number) {
        this.params[3] = value;
    }

    public get param4(): number {
        return this.params[4];
    }

    public set param4(value: number) {
        this.params[4] = value;
    }

    public get param5(): number {
        return this.params[5];
    }

    public set param5(value: number) {
        this.params[5] = value;
    }

    public get param6(): number {
        return this.params[6];
    }

    public set param6(value: number) {
        this.params[6] = value;
    }

    public get param7(): number {
        return this.params[7];
    }

    public set param7(value: number) {
        this.params[7] = value;
    }
}

export function sameSurfaceShader(a: GpuSurfaceShader, b: GpuSurfaceShader): boolean {
    if (a === b) return true;
    if (a.name !== b.name) return false;
    const aParams = a.params, bParams = b.params;
    for (let i = 0; i < SURFACE_SHADER_PARAMS; i++) if (aParams[i] !== bParams[i]) return false;
    return true;
}
