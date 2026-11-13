import {Component, Entity} from "../core";
import {EntityWriteOptions} from "../core/entityWriteOptions";
import {RenderBounds} from "./renderBounds";
import {TextColor} from "./textColor";

export const TRANSPARENT_GLYPH = -1;

const NO_TRANSPARENT_CODE_POINT = -2;
const FIRST_ASTRAL_CODE_POINT = 0x10000;
const SURROGATE_PAIR_LENGTH = 2;
const SPACE = " ";

export interface TextCellRow {
    readonly width: number;
    readonly glyphs: ArrayLike<number>;
    readonly foregrounds: ArrayLike<TextColor>;
    readonly backgrounds: ArrayLike<TextColor>;
}

export interface BlittableText {
    readonly sizeY: number;
    rowAt(y: number): TextCellRow;
}

class TextSpriteRow implements TextCellRow {
    public width = 0;
    public readonly glyphs: number[] = [];
    public readonly foregrounds: TextColor[] = [];
    public readonly backgrounds: TextColor[] = [];
}

function codeUnitsOf(codePoint: number): number {
    return codePoint >= FIRST_ASTRAL_CODE_POINT ? SURROGATE_PAIR_LENGTH : 1;
}

function transparentCodePointOf(transparentChar: string | undefined): number {
    if (transparentChar === undefined) return NO_TRANSPARENT_CODE_POINT;
    const codePoint = transparentChar.codePointAt(0);
    if (codePoint === undefined || codeUnitsOf(codePoint) !== transparentChar.length) return NO_TRANSPARENT_CODE_POINT;
    return codePoint;
}

function plainTextOf(row: TextCellRow): string {
    let text = "";
    for (let x = 0; x < row.width; x++) {
        const glyph = row.glyphs[x];
        text += glyph === TRANSPARENT_GLYPH ? SPACE : String.fromCodePoint(glyph);
    }
    return text;
}

export class TextSprite extends Component {
    private _image: string[] = [];
    private _transparentChar: string | undefined = SPACE;
    private _foreground: TextColor = TextColor.DEFAULT;
    private _background: TextColor = TextColor.DEFAULT;
    private _styledRowsAssigned = false;
    private _rows: TextSpriteRow[] = [];
    private _sizeX: number = 0;
    private _sizeY: number = 0;

    public setup(entity: Entity, entityManager: EntityWriteOptions) {
        entityManager.addComponent(entity, new RenderBounds())
    }

    public get sizeX(): number {
        return this._sizeX;
    }

    public get sizeY(): number {
        return this._sizeY;
    }

    public get image(): string[] {
        return this._image;
    }

    public set image(value: string[]) {
        this._image = value;
        this._styledRowsAssigned = false;
        this.recalculateFromImage();
    }

    public get transparentChar(): string | undefined {
        return this._transparentChar;
    }

    public set transparentChar(value: string | undefined) {
        this._transparentChar = value;
        if (!this._styledRowsAssigned) this.recalculateFromImage();
    }

    public get foreground(): TextColor {
        return this._foreground;
    }

    public set foreground(value: TextColor) {
        this._foreground = value;
        if (!this._styledRowsAssigned) this.recalculateFromImage();
    }

    public get background(): TextColor {
        return this._background;
    }

    public set background(value: TextColor) {
        this._background = value;
        if (!this._styledRowsAssigned) this.recalculateFromImage();
    }

    public rowAt(y: number): TextCellRow {
        if (y < 0 || y >= this._sizeY) throw new RangeError(`TextSprite.rowAt: row ${y} is outside [0, ${this._sizeY})`);
        return this._rows[y];
    }

    public setStyledRows(rows: readonly TextCellRow[]): void {
        let widest = 0;
        for (let y = 0; y < rows.length; y++) {
            const source = rows[y];
            const row = this.reusableRow(y);
            const width = source.width;
            for (let x = 0; x < width; x++) {
                row.glyphs[x] = source.glyphs[x];
                row.foregrounds[x] = source.foregrounds[x];
                row.backgrounds[x] = source.backgrounds[x];
            }
            row.width = width;
            if (width > widest) widest = width;
        }
        this._image = rows.map(plainTextOf);
        this._styledRowsAssigned = true;
        this._sizeX = widest;
        this._sizeY = rows.length;
    }

    private reusableRow(y: number): TextSpriteRow {
        let row = this._rows[y];
        if (row === undefined) row = this._rows[y] = new TextSpriteRow();
        return row;
    }

    private recalculateFromImage(): void {
        const lines = this._image;
        const transparent = transparentCodePointOf(this._transparentChar);
        const foreground = this._foreground;
        const background = this._background;

        let widest = 0;
        for (let y = 0; y < lines.length; y++) {
            const line = lines[y];
            const row = this.reusableRow(y);
            const glyphs = row.glyphs, foregrounds = row.foregrounds, backgrounds = row.backgrounds;
            let width = 0;
            for (let i = 0; i < line.length;) {
                const codePoint = line.codePointAt(i)!;
                i += codeUnitsOf(codePoint);
                glyphs[width] = codePoint === transparent ? TRANSPARENT_GLYPH : codePoint;
                foregrounds[width] = foreground;
                backgrounds[width] = background;
                width++;
            }
            row.width = width;
            if (width > widest) widest = width;
        }

        this._sizeX = widest;
        this._sizeY = lines.length;
    }
}
