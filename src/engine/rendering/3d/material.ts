import {Texture} from "./texture";
import type {AssetLoadOptions} from "../../platform";
import {WHITE_RGB, RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK, CHANNEL_MAX} from "../packedRgb";


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
        public diffuseColor: number = WHITE_RGB,
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

export function loadMaterialTextures(materials: readonly Material[], options: AssetLoadOptions, cache: Map<string, Texture> = new Map()): void {
    const files = options.files;
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
                texture = Texture.fromFile(path, options);
                cache.set(path, texture);
            }
            material[slot.texture] = texture;
        }
    }
}

export function packRgb(r: number, g: number, b: number): number {
    return (clampToByte(r * CHANNEL_MAX) << RED_SHIFT) | (clampToByte(g * CHANNEL_MAX) << GREEN_SHIFT) | clampToByte(b * CHANNEL_MAX);
}

export function multiplyPackedRgb(a: number, b: number): number {
    const r = (((a >> RED_SHIFT) & CHANNEL_MASK) * ((b >> RED_SHIFT) & CHANNEL_MASK)) / CHANNEL_MAX;
    const g = (((a >> GREEN_SHIFT) & CHANNEL_MASK) * ((b >> GREEN_SHIFT) & CHANNEL_MASK)) / CHANNEL_MAX;
    const bl = ((a & CHANNEL_MASK) * (b & CHANNEL_MASK)) / CHANNEL_MAX;
    return (clampToByte(r) << RED_SHIFT) | (clampToByte(g) << GREEN_SHIFT) | clampToByte(bl);
}

function clampToByte(value: number): number {
    return value <= 0 ? 0 : value >= CHANNEL_MAX ? CHANNEL_MAX : Math.round(value);
}
