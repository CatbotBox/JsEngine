import {decodeImageFile} from "../../assets/image/decodedImage";
import type {AssetLoadOptions, FileSource} from "../../platform";
import {RED_SHIFT, GREEN_SHIFT, CHANNEL_MASK} from "../packedRgb";
import type {SpritePatternColor, SpritePatternSource} from "./spritePattern";

const RGBA_BYTES = 4;
const OPAQUE_ALPHA = 255;
const NO_SOURCE_FILE: string | undefined = undefined;
const NO_PATTERN: SpritePatternSource | undefined = undefined;

interface PatternPixels {
    readonly width: number;
    readonly height: number;
    readonly rgba: Uint8Array;
}

function colorsByChar(palette: readonly Readonly<SpritePatternColor>[]): Record<string, number> {
    const colors: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const color of palette) if (colors[color.char] === undefined) colors[color.char] = color.rgb;
    return colors;
}

function patternPixels(rows: readonly string[], colors: Readonly<Record<string, number>>): PatternPixels {
    let width = 0;
    for (const row of rows) if (row.length > width) width = row.length;
    const height = rows.length;
    const rgba = new Uint8Array(width * height * RGBA_BYTES);
    for (let y = 0; y < height; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
            const color = colors[row[x]];
            if (color === undefined) continue;
            const i = (y * width + x) * RGBA_BYTES;
            rgba[i] = (color >> RED_SHIFT) & CHANNEL_MASK;
            rgba[i + 1] = (color >> GREEN_SHIFT) & CHANNEL_MASK;
            rgba[i + 2] = color & CHANNEL_MASK;
            rgba[i + 3] = OPAQUE_ALPHA;
        }
    }
    return {width, height, rgba};
}

function frozenPatternSource(source: SpritePatternSource): SpritePatternSource {
    return Object.freeze({
        rows: Object.freeze([...source.rows]),
        palette: Object.freeze(source.palette.map(({char, rgb}) => Object.freeze({char, rgb}))),
    });
}

export class SpriteImage {
    private static fileCaches = new WeakMap<FileSource, Map<string, SpriteImage>>();

    public readonly sizeX: number;
    public readonly sizeY: number;
    public readonly rgba: Uint8Array;
    public readonly sourcePath: string | undefined;
    public readonly pattern: SpritePatternSource | undefined;

    private constructor(width: number, height: number, rgba: Uint8Array, sourcePath: string | undefined, pattern: SpritePatternSource | undefined) {
        if (rgba.length !== width * height * RGBA_BYTES) {
            throw new Error(`SpriteImage: expected ${width * height * RGBA_BYTES} bytes for ${width}x${height}, got ${rgba.length}`);
        }
        this.sizeX = width;
        this.sizeY = height;
        this.rgba = rgba;
        this.sourcePath = sourcePath;
        this.pattern = pattern;
        Object.freeze(this);
    }

    public static fromPixels(width: number, height: number, rgba: Uint8Array): SpriteImage {
        return new SpriteImage(width, height, rgba.slice(), NO_SOURCE_FILE, NO_PATTERN);
    }

    public static fromFile(filePath: string, options: AssetLoadOptions): SpriteImage {
        const files = options.files;
        let cache = SpriteImage.fileCaches.get(files);
        if (cache === undefined) {
            cache = new Map();
            SpriteImage.fileCaches.set(files, cache);
        }
        let image = cache.get(filePath);
        if (image === undefined) {
            const decoded = decodeImageFile(filePath, options);
            image = new SpriteImage(decoded.width, decoded.height, decoded.rgba, filePath, NO_PATTERN);
            cache.set(filePath, image);
        }
        return image;
    }

    public static solid(width: number, height: number, color: number): SpriteImage {
        const rgba = new Uint8Array(width * height * RGBA_BYTES);
        const r = (color >> RED_SHIFT) & CHANNEL_MASK, g = (color >> GREEN_SHIFT) & CHANNEL_MASK, b = color & CHANNEL_MASK;
        for (let i = 0; i < rgba.length; i += RGBA_BYTES) {
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = OPAQUE_ALPHA;
        }
        return new SpriteImage(width, height, rgba, NO_SOURCE_FILE, NO_PATTERN);
    }

    public static fromPattern(rows: readonly string[], palette: Readonly<Record<string, number>>): SpriteImage {
        const pixels = patternPixels(rows, palette);
        return new SpriteImage(pixels.width, pixels.height, pixels.rgba, NO_SOURCE_FILE, NO_PATTERN);
    }

    public static fromPatternSource(source: SpritePatternSource, sourcePath?: string): SpriteImage {
        const pattern = frozenPatternSource(source);
        const pixels = patternPixels(pattern.rows, colorsByChar(pattern.palette));
        return new SpriteImage(pixels.width, pixels.height, pixels.rgba, sourcePath, pattern);
    }
}
