import {DecodedImage, decodeImageFile} from "./image/decodedImage";
import "./image/png";
import "./image/ppm";
import "./image/jpeg";

export interface TextureLevel {
    readonly width: number;
    readonly height: number;
    /** Row-major packed 0xAARRGGBB texels. */
    readonly texels: Int32Array;
}

export class Texture {
    public static maxDimension = 512;

    private constructor(public readonly levels: readonly TextureLevel[]) {
    }

    public get width(): number {
        return this.levels[0].width;
    }

    public get height(): number {
        return this.levels[0].height;
    }

    public get texelCount(): number {
        let total = 0;
        for (const level of this.levels) total += level.width * level.height;
        return total;
    }

    public static fromFile(filePath: string, maxDimension: number = Texture.maxDimension): Texture {
        return Texture.fromImage(decodeImageFile(filePath), maxDimension);
    }

    public static fromImage(image: DecodedImage, maxDimension: number = Texture.maxDimension): Texture {
        return Texture.fromRgba(image.width, image.height, image.rgba, maxDimension);
    }

    public static fromRgba(width: number, height: number, rgba: Uint8Array, maxDimension: number = Texture.maxDimension): Texture {
        if (width <= 0 || height <= 0) throw new Error("A texture needs at least one texel");
        let base = packLevel(width, height, rgba);
        while (base.width > maxDimension || base.height > maxDimension) base = halve(base);
        const levels: TextureLevel[] = [base];
        while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) {
            levels.push(halve(levels[levels.length - 1]));
        }
        return new Texture(levels);
    }

    public sample(level: number, u: number, v: number): number {
        const {width, height, texels} = this.levels[Math.max(0, Math.min(this.levels.length - 1, level))];
        const x = Math.floor((u - Math.floor(u)) * width);
        const y = Math.floor((v - Math.floor(v)) * height);
        return texels[y * width + x];
    }
}

function packLevel(width: number, height: number, rgba: Uint8Array): TextureLevel {
    const texels = new Int32Array(width * height);
    for (let i = 0, j = 0; i < texels.length; i++, j += 4) {
        texels[i] = (rgba[j + 3] << 24) | (rgba[j] << 16) | (rgba[j + 1] << 8) | rgba[j + 2];
    }
    return {width, height, texels};
}

function halve(level: TextureLevel): TextureLevel {
    const width = Math.max(1, level.width >> 1);
    const height = Math.max(1, level.height >> 1);
    const texels = new Int32Array(width * height);
    const source = level.texels;
    const lastX = level.width - 1, lastY = level.height - 1;
    for (let y = 0; y < height; y++) {
        const y0 = Math.min(lastY, y * 2), y1 = Math.min(lastY, y * 2 + 1);
        for (let x = 0; x < width; x++) {
            const x0 = Math.min(lastX, x * 2), x1 = Math.min(lastX, x * 2 + 1);
            texels[y * width + x] = averageFour(
                source[y0 * level.width + x0], source[y0 * level.width + x1],
                source[y1 * level.width + x0], source[y1 * level.width + x1],
            );
        }
    }
    return {width, height, texels};
}

function averageFour(a: number, b: number, c: number, d: number): number {
    const alpha = (((a >>> 24) + (b >>> 24) + (c >>> 24) + (d >>> 24) + 2) >> 2) & 255;
    const red = ((((a >> 16) & 255) + ((b >> 16) & 255) + ((c >> 16) & 255) + ((d >> 16) & 255) + 2) >> 2) & 255;
    const green = ((((a >> 8) & 255) + ((b >> 8) & 255) + ((c >> 8) & 255) + ((d >> 8) & 255) + 2) >> 2) & 255;
    const blue = (((a & 255) + (b & 255) + (c & 255) + (d & 255) + 2) >> 2) & 255;
    return (alpha << 24) | (red << 16) | (green << 8) | blue;
}
