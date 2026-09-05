import {Texture} from "../../3d/texture";

/**
 * Texel storage the raster kernel reads: one flat Int32Array holding every mip
 * level of every uploaded texture, plus a descriptor table the kernel indexes by
 * texture id. Both live in SharedArrayBuffers when a worker pool is in use, so
 * the layout constants below are mirrored as literals inside rasterizeTriangleBand.
 *
 * Descriptor layout per texture (DESCRIPTOR_STRIDE ints):
 *   [0] levelCount
 *   [1 + level * 3] texel offset, [2 + level * 3] width, [3 + level * 3] height
 */
export class TextureStore {
    public static readonly MAX_LEVELS = 16;
    public static readonly LEVEL_STRIDE = 3;
    public static readonly DESCRIPTOR_STRIDE = 1 + TextureStore.MAX_LEVELS * TextureStore.LEVEL_STRIDE;
    public static readonly NO_TEXTURE = -1;

    private readonly idByTexture = new WeakMap<Texture, number>();
    private usedTexels = 0;
    private textureCount = 0;

    public constructor(
        public texels: Int32Array<ArrayBufferLike>,
        public table: Int32Array<ArrayBufferLike>,
        private readonly growable: boolean,
    ) {
    }

    public static growable(): TextureStore {
        return new TextureStore(new Int32Array(0), new Int32Array(0), true);
    }

    public get textureCapacity(): number {
        return (this.table.length / TextureStore.DESCRIPTOR_STRIDE) | 0;
    }

    public get uploadedTextureCount(): number {
        return this.textureCount;
    }

    public get uploadedTexelCount(): number {
        return this.usedTexels;
    }

    public idOf(texture: Texture): number {
        const existing = this.idByTexture.get(texture);
        if (existing !== undefined) return existing;
        const id = this.upload(texture);
        if (id !== TextureStore.NO_TEXTURE) this.idByTexture.set(texture, id);
        return id;
    }

    public levelCountOf(id: number): number {
        return this.table[id * TextureStore.DESCRIPTOR_STRIDE];
    }

    public baseTexelAreaOf(id: number): number {
        const descriptor = id * TextureStore.DESCRIPTOR_STRIDE;
        return this.table[descriptor + 2] * this.table[descriptor + 3];
    }

    private upload(texture: Texture): number {
        const levels = texture.levels.slice(0, TextureStore.MAX_LEVELS);
        let texelCount = 0;
        for (const level of levels) texelCount += level.width * level.height;

        if (!this.ensureCapacity(texelCount)) return TextureStore.NO_TEXTURE;

        const id = this.textureCount++;
        const descriptor = id * TextureStore.DESCRIPTOR_STRIDE;
        this.table[descriptor] = levels.length;
        let offset = this.usedTexels;
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            const entry = descriptor + 1 + i * TextureStore.LEVEL_STRIDE;
            this.table[entry] = offset;
            this.table[entry + 1] = level.width;
            this.table[entry + 2] = level.height;
            this.texels.set(level.texels, offset);
            offset += level.width * level.height;
        }
        this.usedTexels = offset;
        return id;
    }

    private ensureCapacity(texelCount: number): boolean {
        const neededTexels = this.usedTexels + texelCount;
        const neededTextures = this.textureCount + 1;
        if (neededTexels <= this.texels.length && neededTextures <= this.textureCapacity) return true;
        if (!this.growable) return false;
        if (neededTexels > this.texels.length) {
            const grown = new Int32Array(Math.max(neededTexels, this.texels.length * 2));
            grown.set(this.texels);
            this.texels = grown;
        }
        if (neededTextures > this.textureCapacity) {
            const grown = new Int32Array(Math.max(neededTextures, this.textureCapacity * 2) * TextureStore.DESCRIPTOR_STRIDE);
            grown.set(this.table);
            this.table = grown;
        }
        return true;
    }
}
