import {Resource} from "../../engine/core";
import type {GpuShader} from "./gpuTypes";
import {LIT_SURFACE_SHADER} from "./gpuSurfaceShader";
import {assembleSurfaceShader, BASIC_LIT} from "./shaders/basicLitShader";

export function unknownSurfaceShaderMessage(name: string): string {
    return `GPU surface shader "${name}" is not registered in GpuShaderLibrary; drawing with the built-in lit shader`;
}

export class GpuShaderLibrary extends Resource {
    private readonly shaders = new Map<string, GpuShader>([[LIT_SURFACE_SHADER, BASIC_LIT]]);
    private readonly reportedUnknownNames = new Set<string>();

    public get names(): readonly string[] {
        return [...this.shaders.keys()];
    }

    public has(name: string): boolean {
        return this.shaders.has(name);
    }

    public register(name: string, surfaceSource: string): GpuShader {
        if (name === LIT_SURFACE_SHADER) throw new Error(`"${LIT_SURFACE_SHADER}" is the built-in surface shader; register custom shaders under another name`);
        const shader = assembleSurfaceShader(name, surfaceSource);
        this.shaders.set(name, shader);
        return shader;
    }

    public shaderNamed(name: string): GpuShader {
        const shader = this.shaders.get(name);
        if (shader !== undefined) return shader;
        if (!this.reportedUnknownNames.has(name)) {
            this.reportedUnknownNames.add(name);
            console.warn(unknownSurfaceShaderMessage(name));
        }
        return BASIC_LIT;
    }
}
