import {System, Unchanged} from "../../core";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {Sprite} from "./sprite";
import type {SpriteImage} from "./spriteImage";
import {SpritePattern, SpritePatternColor, spritePatternImage} from "./spritePattern";

const PRIORITY_BEFORE_SPRITE_BOUNDS = -30;
const NO_ROWS: readonly string[] = [];
const NO_COLORS: readonly SpritePatternColor[] = [];

function sameRows(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function samePalette(a: readonly SpritePatternColor[], b: readonly SpritePatternColor[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i].char !== b[i].char || a[i].rgb !== b[i].rgb) return false;
    return true;
}

function patternKey(rows: readonly string[], palette: readonly SpritePatternColor[]): string {
    return JSON.stringify([rows, palette.map(color => [color.char, color.rgb])]);
}

export class SpritePatternImages {
    private readonly imagesByKey = new Map<string, SpriteImage>();
    private lastRows: readonly string[] = NO_ROWS;
    private lastPalette: readonly SpritePatternColor[] = NO_COLORS;
    private lastImage: SpriteImage | undefined;

    public imageOf(rows: readonly string[], palette: readonly SpritePatternColor[]): SpriteImage {
        const last = this.lastImage;
        if (last !== undefined && sameRows(rows, this.lastRows) && samePalette(palette, this.lastPalette)) return last;
        const key = patternKey(rows, palette);
        let image = this.imagesByKey.get(key);
        if (image === undefined) {
            image = spritePatternImage(rows, palette);
            this.imagesByKey.set(key, image);
        }
        this.lastRows = [...rows];
        this.lastPalette = palette.map(color => new SpritePatternColor(color.char, color.rgb));
        this.lastImage = image;
        return image;
    }
}

export class SpritePatternImageSystem extends System {
    private _query = this.createEntityQuery([SpritePattern, Sprite]);
    private _images = new SpritePatternImages();

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_BEFORE_SPRITE_BOUNDS;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
    }

    onUpdate() {
        const images = this._images;
        this._query.stream({
            read: {pattern: SpritePattern},
            write: {sprite: Sprite},
        }, {
            filterLastUpdated: this.lastUpdateStamp,
            structuralFilter: "additions",
            filterBlackList: [Sprite],
            includeDisabled: true,
        }).consumeSpans(({start, end, stores}) => {
            const patterns = stores.pattern!;
            const sprites = stores.sprite!;
            let wrote = false;
            for (let i = start; i < end; i++) {
                const pattern = patterns.get(i) as SpritePattern;
                const image = images.imageOf(pattern.rows, pattern.palette);
                const sprite = sprites.get(i) as Sprite;
                if (sprite.image === image) continue;
                sprite.image = image;
                wrote = true;
            }
            return wrote ? undefined : Unchanged;
        });
    }
}
