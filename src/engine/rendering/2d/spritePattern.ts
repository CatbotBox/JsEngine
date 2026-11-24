import {WHITE_RGB} from "../packedRgb";
import {SpriteImage} from "./spriteImage";

export const DEFAULT_SPRITE_PATTERN_CHAR = "#";

export class SpritePatternColor {
    public constructor(public char: string = DEFAULT_SPRITE_PATTERN_CHAR, public rgb: number = WHITE_RGB) {
    }
}

export interface SpritePatternSource {
    readonly rows: readonly string[];
    readonly palette: readonly Readonly<SpritePatternColor>[];
}

export function spritePatternImage(rows: readonly string[], palette: readonly Readonly<SpritePatternColor>[]): SpriteImage {
    return SpriteImage.fromPatternSource({rows, palette});
}
