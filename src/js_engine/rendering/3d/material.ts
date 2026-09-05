import {Texture} from "./texture";

export class Material {
    public static readonly DEFAULT_NAME = "default";

    public diffuseTexture?: Texture;

    public constructor(
        public readonly name: string = Material.DEFAULT_NAME,
        public diffuseColor: number = 0xFFFFFF,
        public diffuseTexturePath?: string,
    ) {
    }

    public static default(): Material {
        return new Material();
    }
}

export function loadMaterialTextures(materials: readonly Material[], cache: Map<string, Texture> = new Map()): void {
    const fs = require("fs") as typeof import("fs");
    for (const material of materials) {
        const path = material.diffuseTexturePath;
        if (path === undefined || material.diffuseTexture !== undefined) continue;
        let texture = cache.get(path);
        if (texture === undefined) {
            if (!fs.existsSync(path)) {
                console.warn(`Texture ${path} for material ${material.name} not found; rendering it untextured`);
                continue;
            }
            texture = Texture.fromFile(path);
            cache.set(path, texture);
        }
        material.diffuseTexture = texture;
    }
}

export function packRgb(r: number, g: number, b: number): number {
    return (clampToByte(r * 255) << 16) | (clampToByte(g * 255) << 8) | clampToByte(b * 255);
}

export function multiplyPackedRgb(a: number, b: number): number {
    const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
    const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
    const bl = ((a & 255) * (b & 255)) / 255;
    return (clampToByte(r) << 16) | (clampToByte(g) << 8) | clampToByte(bl);
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}
