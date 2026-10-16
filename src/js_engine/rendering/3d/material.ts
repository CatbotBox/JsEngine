import {Texture} from "./texture";
import type {AssetLoadOptions} from "../../platform";
import {nodePlatform} from "../../platform";

export class Material {
    public static readonly DEFAULT_NAME = "default";

    public diffuseTexture?: Texture;
    public specularColor: number = 0;
    public shininess: number = 0;
    public emissiveColor: number = 0;
    public specularTexturePath?: string;
    public specularTexture?: Texture;

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

interface TextureSlot {
    readonly path: "diffuseTexturePath" | "specularTexturePath";
    readonly texture: "diffuseTexture" | "specularTexture";
}

const TEXTURE_SLOTS: readonly TextureSlot[] = [
    {path: "diffuseTexturePath", texture: "diffuseTexture"},
    {path: "specularTexturePath", texture: "specularTexture"},
];

export function loadMaterialTextures(materials: readonly Material[], cache: Map<string, Texture> = new Map(), options: AssetLoadOptions = {}): void {
    const files = options.files ?? nodePlatform().files;
    for (const material of materials) {
        for (const slot of TEXTURE_SLOTS) {
            const path = material[slot.path];
            if (path === undefined || material[slot.texture] !== undefined) continue;
            let texture = cache.get(path);
            if (texture === undefined) {
                if (!files.exists(path)) {
                    console.warn(`Texture ${path} for material ${material.name} not found; rendering it untextured`);
                    continue;
                }
                texture = Texture.fromFile(path, Texture.maxDimension, {files, inflate: options.inflate});
                cache.set(path, texture);
            }
            material[slot.texture] = texture;
        }
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
