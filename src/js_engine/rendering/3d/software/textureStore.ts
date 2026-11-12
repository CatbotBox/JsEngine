import {Texture} from "../texture";

const LEVELS_OFFSET = 1;
const LEVEL_TEXEL_OFFSET_SLOT = 0;
const LEVEL_WIDTH_SLOT = 1;
const LEVEL_HEIGHT_SLOT = 2;
const GROWABLE = true;

export class TextureStore {
    public static readonly MAX_LEVELS = 16;
    public static readonly LEVEL_STRIDE = 3;
    public static readonly DESCRIPTOR_STRIDE = LEVELS_OFFSET + TextureStore.MAX_LEVELS * TextureStore.LEVEL_STRIDE;
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
        return new TextureStore(new Int32Array(0), new Int32Array(0), GROWABLE);
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
        const firstLevel = descriptor + LEVELS_OFFSET;
        return this.table[firstLevel + LEVEL_WIDTH_SLOT] * this.table[firstLevel + LEVEL_HEIGHT_SLOT];
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
            const entry = descriptor + LEVELS_OFFSET + i * TextureStore.LEVEL_STRIDE;
            this.table[entry + LEVEL_TEXEL_OFFSET_SLOT] = offset;
            this.table[entry + LEVEL_WIDTH_SLOT] = level.width;
            this.table[entry + LEVEL_HEIGHT_SLOT] = level.height;
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
