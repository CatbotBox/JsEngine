import {decodeImageFile} from "../3d/image/decodedImage";
import "../3d/image/builtinDecoders";

/**
 * Immutable shared pixel data for Sprite — the 2D counterpart of Mesh:
 * any number of entities reference one SpriteImage while per-entity looks
 * (tint, opacity) stay on the component. Sharing one image keeps entity
 * creation allocation-free, the blit loop on one hot buffer, and file decodes
 * to one per path.
 *
 * Instances are frozen and pixel data is defensively copied where the caller
 * could still hold a reference, so an image never changes under its users. To
 * change what a sprite shows, assign a different SpriteImage to the component
 * — that is a component write the change tracking sees, where an in-place
 * pixel edit would bypass it (and stale bounds/render skips would follow).
 */
export class SpriteImage {
    private static fileCache = new Map<string, SpriteImage>();

    public readonly sizeX: number;
    public readonly sizeY: number;
    /**
     * Row-major RGBA, 4 bytes per pixel, top row first. Treat as read-only:
     * typed arrays cannot be Object.frozen, so this is the one door immutability
     * cannot lock. Every factory hands the instance a private copy.
     */
    public readonly rgba: Uint8Array;

    private constructor(width: number, height: number, rgba: Uint8Array) {
        if (rgba.length !== width * height * 4) {
            throw new Error(`SpriteImage: expected ${width * height * 4} bytes for ${width}x${height}, got ${rgba.length}`);
        }
        this.sizeX = width;
        this.sizeY = height;
        this.rgba = rgba;
        Object.freeze(this);
    }

    /** Build from caller-provided RGBA; the buffer is copied, so later edits to it don't leak in. */
    public static fromPixels(width: number, height: number, rgba: Uint8Array): SpriteImage {
        return new SpriteImage(width, height, rgba.slice());
    }

    /**
     * Decode a .png/.jpg/.ppm through the engine's dependency-free decoders
     * (same set the 3D texture loader uses). Decodes once per path: repeat
     * calls return the same cached instance — safe because images are immutable.
     */
    public static fromFile(filePath: string): SpriteImage {
        let image = SpriteImage.fileCache.get(filePath);
        if (image === undefined) {
            const decoded = decodeImageFile(filePath);
            // The decoder allocates a fresh buffer nothing else holds; no copy needed.
            image = new SpriteImage(decoded.width, decoded.height, decoded.rgba);
            SpriteImage.fileCache.set(filePath, image);
        }
        return image;
    }

    /** A width x height image of one packed 0xRRGGBB color (alpha 255). */
    public static solid(width: number, height: number, color: number): SpriteImage {
        const rgba = new Uint8Array(width * height * 4);
        const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
        for (let i = 0; i < rgba.length; i += 4) {
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
        return new SpriteImage(width, height, rgba);
    }

    /**
     * Build pixel art from strings: each character indexes `palette` for its
     * packed 0xRRGGBB; characters missing from the palette are transparent.
     * Rows may differ in length — short rows pad transparent.
     */
    public static fromPattern(rows: readonly string[], palette: Readonly<Record<string, number>>): SpriteImage {
        let width = 0;
        for (const row of rows) if (row.length > width) width = row.length;
        const height = rows.length;
        const rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const row = rows[y];
            for (let x = 0; x < row.length; x++) {
                const color = palette[row[x]];
                if (color === undefined) continue;
                const i = (y * width + x) * 4;
                rgba[i] = (color >> 16) & 255;
                rgba[i + 1] = (color >> 8) & 255;
                rgba[i + 2] = color & 255;
                rgba[i + 3] = 255;
            }
        }
        return new SpriteImage(width, height, rgba);
    }
}
