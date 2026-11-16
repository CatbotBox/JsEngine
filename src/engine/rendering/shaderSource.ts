export const WGSL_FILE_SUFFIX = ".wgsl";

export class ShaderSource {
    public constructor(public readonly sourcePath: string | undefined, public readonly code: string) {
    }
}
