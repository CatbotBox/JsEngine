import {Resource} from "../core";
import type {TextColor} from "../rendering/textColor";
import type {UiBorderStyle} from "./layout/flexStyle";

export const UI_DRAW_FILL = 0;
export const UI_DRAW_BORDER = 1;
export const UI_DRAW_TEXT = 2;

export const UI_BORDER_NONE = 0;
export const UI_BORDER_SINGLE = 1;
export const UI_BORDER_DOUBLE = 2;
export const UI_BORDER_THICK = 3;

export const UI_DRAW_X = 0;
export const UI_DRAW_Y = 1;
export const UI_DRAW_WIDTH = 2;
export const UI_DRAW_HEIGHT = 3;
export const UI_DRAW_CLIP_LEFT = 4;
export const UI_DRAW_CLIP_TOP = 5;
export const UI_DRAW_CLIP_RIGHT = 6;
export const UI_DRAW_CLIP_BOTTOM = 7;
export const UI_DRAW_FLOATS = 8;

const BORDER_CODES: Readonly<Record<UiBorderStyle, number>> = {
    none: UI_BORDER_NONE,
    single: UI_BORDER_SINGLE,
    double: UI_BORDER_DOUBLE,
    thick: UI_BORDER_THICK,
};

const INITIAL_CAPACITY_COMMANDS = 16;
const INITIAL_CAPACITY_GLYPHS = 64;
const CAPACITY_GROWTH_FACTOR = 2;
const NO_GLYPHS = 0;
const TEXT_HEIGHT_UNITS = 1;
const NO_ROOT = -1;
const NO_OPEN_TEXT = -1;

function grownCapacity(capacity: number, required: number): number {
    let grown = capacity;
    while (grown < required) grown *= CAPACITY_GROWTH_FACTOR;
    return grown;
}

function grownInt32(values: Int32Array, capacity: number): Int32Array {
    const next = new Int32Array(capacity);
    next.set(values);
    return next;
}

function grownUint8(values: Uint8Array, capacity: number): Uint8Array {
    const next = new Uint8Array(capacity);
    next.set(values);
    return next;
}

export class UiDrawList extends Resource {
    private _count = 0;
    private _version = 0;
    private _kinds: Uint8Array = new Uint8Array(INITIAL_CAPACITY_COMMANDS);
    private _roots: Int32Array = new Int32Array(INITIAL_CAPACITY_COMMANDS);
    private _colors: Int32Array = new Int32Array(INITIAL_CAPACITY_COMMANDS);
    private _borders: Uint8Array = new Uint8Array(INITIAL_CAPACITY_COMMANDS);
    private _glyphStarts: Int32Array = new Int32Array(INITIAL_CAPACITY_COMMANDS);
    private _glyphCounts: Int32Array = new Int32Array(INITIAL_CAPACITY_COMMANDS);
    private _geometry = new Float64Array(INITIAL_CAPACITY_COMMANDS * UI_DRAW_FLOATS);
    private _glyphs: Int32Array = new Int32Array(INITIAL_CAPACITY_GLYPHS);
    private _glyphTotal = 0;
    private readonly _rootScales: number[] = [];
    private _root = NO_ROOT;
    private _clipLeft = 0;
    private _clipTop = 0;
    private _clipRight = 0;
    private _clipBottom = 0;
    private _openText = NO_OPEN_TEXT;

    public get count(): number {
        return this._count;
    }

    public get version(): number {
        return this._version;
    }

    public get kinds(): Uint8Array {
        return this._kinds;
    }

    public get roots(): Int32Array {
        return this._roots;
    }

    public get colors(): Int32Array {
        return this._colors;
    }

    public get borders(): Uint8Array {
        return this._borders;
    }

    public get glyphStarts(): Int32Array {
        return this._glyphStarts;
    }

    public get glyphCounts(): Int32Array {
        return this._glyphCounts;
    }

    public get geometry(): Float64Array {
        return this._geometry;
    }

    public get glyphs(): Int32Array {
        return this._glyphs;
    }

    public get rootScales(): readonly number[] {
        return this._rootScales;
    }

    public clear(): void {
        this._count = 0;
        this._glyphTotal = 0;
        this._rootScales.length = 0;
        this._root = NO_ROOT;
        this._openText = NO_OPEN_TEXT;
    }

    public finish(): void {
        this._version++;
    }

    public beginRoot(scale: number): void {
        this._root = this._rootScales.length;
        this._rootScales.push(scale);
    }

    public clipTo(left: number, top: number, right: number, bottom: number): void {
        this._clipLeft = left;
        this._clipTop = top;
        this._clipRight = Math.max(left, right);
        this._clipBottom = Math.max(top, bottom);
    }

    public fillRect(x: number, y: number, width: number, height: number, color: TextColor): void {
        this.append(UI_DRAW_FILL, x, y, width, height, color);
    }

    public border(x: number, y: number, width: number, height: number, style: UiBorderStyle, color: TextColor): void {
        const command = this.append(UI_DRAW_BORDER, x, y, width, height, color);
        this._borders[command] = BORDER_CODES[style];
    }

    public beginText(x: number, y: number, foreground: TextColor): void {
        this._openText = this.append(UI_DRAW_TEXT, x, y, 0, TEXT_HEIGHT_UNITS, foreground);
        this._glyphStarts[this._openText] = this._glyphTotal;
    }

    public addGlyph(codePoint: number, columns: number): void {
        const text = this._openText;
        if (this._glyphTotal >= this._glyphs.length) this._glyphs = grownInt32(this._glyphs, grownCapacity(this._glyphs.length, this._glyphTotal + 1));
        this._glyphs[this._glyphTotal++] = codePoint;
        this._glyphCounts[text]++;
        this._geometry[text * UI_DRAW_FLOATS + UI_DRAW_WIDTH] += columns;
    }

    private append(kind: number, x: number, y: number, width: number, height: number, color: TextColor): number {
        const command = this._count;
        this.ensureCapacity(command + 1);
        this._kinds[command] = kind;
        this._roots[command] = this._root;
        this._colors[command] = color as number;
        this._borders[command] = UI_BORDER_NONE;
        this._glyphStarts[command] = this._glyphTotal;
        this._glyphCounts[command] = NO_GLYPHS;
        const base = command * UI_DRAW_FLOATS, geometry = this._geometry;
        geometry[base + UI_DRAW_X] = x;
        geometry[base + UI_DRAW_Y] = y;
        geometry[base + UI_DRAW_WIDTH] = width;
        geometry[base + UI_DRAW_HEIGHT] = height;
        geometry[base + UI_DRAW_CLIP_LEFT] = this._clipLeft;
        geometry[base + UI_DRAW_CLIP_TOP] = this._clipTop;
        geometry[base + UI_DRAW_CLIP_RIGHT] = this._clipRight;
        geometry[base + UI_DRAW_CLIP_BOTTOM] = this._clipBottom;
        this._count = command + 1;
        return command;
    }

    private ensureCapacity(count: number): void {
        if (count <= this._kinds.length) return;
        const capacity = grownCapacity(this._kinds.length, count);
        this._kinds = grownUint8(this._kinds, capacity);
        this._roots = grownInt32(this._roots, capacity);
        this._colors = grownInt32(this._colors, capacity);
        this._borders = grownUint8(this._borders, capacity);
        this._glyphStarts = grownInt32(this._glyphStarts, capacity);
        this._glyphCounts = grownInt32(this._glyphCounts, capacity);
        const geometry = new Float64Array(capacity * UI_DRAW_FLOATS);
        geometry.set(this._geometry);
        this._geometry = geometry;
    }
}
