import {Component} from "../../core";
import {WHITE_RGB} from "../packedRgb";
import {SpriteImage} from "./spriteImage";

export const DEFAULT_SPRITE_PATTERN_CHAR = "#";

export class SpritePatternColor {
    public constructor(public char: string = DEFAULT_SPRITE_PATTERN_CHAR, public rgb: number = WHITE_RGB) {
    }
}

export class SpritePattern extends Component {
    public constructor(public rows: string[] = [], public palette: SpritePatternColor[] = []) {
        super();
    }
}

const spritePatternImages = new WeakSet<SpriteImage>();

function colorsByChar(palette: readonly SpritePatternColor[]): Record<string, number> {
    const colors: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const color of palette) if (colors[color.char] === undefined) colors[color.char] = color.rgb;
    return colors;
}

export function spritePatternImage(rows: readonly string[], palette: readonly SpritePatternColor[]): SpriteImage {
    const image = SpriteImage.fromPattern(rows, colorsByChar(palette));
    spritePatternImages.add(image);
    return image;
}

export function isSpritePatternImage(image: SpriteImage): boolean {
    return spritePatternImages.has(image);
}
