import {beforeEach, describe, expect, test} from "../../../engine/testing/harness";
import {TextColor} from "../../../engine/rendering/textColor";
import {CellKind, copyCellFrame, NO_COLOR} from "../cellFrame";
import type {CellBackgroundStyle, CellFrame} from "../cellFrame";
import {CanvasCellPresenter, DEFAULT_CANVAS_CELL_FONT} from "./canvasCellPresenter";
import {GLYPH_ATLAS_CAPACITY_GLYPHS, GLYPH_ATLAS_SLOT_COLUMNS, GLYPH_ATLAS_SLOT_ROWS} from "./canvasGlyphAtlas";
import {cssColor, paletteRgb, textColorRgb, THEME_BACKGROUND_RGB, THEME_FOREGROUND_RGB} from "./canvasCellColors";
import type {CanvasCellContext, CanvasGlyphAtlasCanvas, CanvasGlyphContext, CanvasTextMetrics} from "./canvasCellSurface";

const GLYPH_WIDTH_CSS_PX = 9;
const GLYPH_ASCENT_CSS_PX = 14;
const GLYPH_DESCENT_CSS_PX = 4;
const CELL_WIDTH = 9;
const CELL_HEIGHT = 18;
const HALF_HEIGHT = 9;
const STANDARD_DENSITY = 1;
const DOUBLE_DENSITY = 2;
const COLUMNS = 8;
const ROWS = 2;

const RED = 0xFF0000;
const GREEN = 0x00FF00;
const BLUE = 0x0000FF;
const PALETTE_BLUE_RGB = 0x0000EE;
const SPACE = 0x20;
const DOT = ".".codePointAt(0)!;
const UPPER_HALF_BLOCK = "▀";
const LOWER_HALF_BLOCK = "▄";
const FULL_BLOCK = "█";
const BELL = 0x07;
const REPLACEMENT_CHARACTER = "�";
const FIRST_DISTINCT_GLYPH = 0x100;

const DEFAULT_STYLE: CellBackgroundStyle = {glyph: SPACE, foreground: TextColor.DEFAULT, background: TextColor.DEFAULT};

interface Fill {
    readonly op: "fill";
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: string;
}

interface GlyphDraw {
    readonly op: "glyph";
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly text: string | undefined;
    readonly color: string | undefined;
    readonly sourceX: number;
    readonly sourceY: number;
}

interface Rasterize {
    readonly op: "rasterize";
    readonly text: string;
    readonly color: string;
}

type Operation = Fill | GlyphDraw | Rasterize;

interface SlotContent {
    readonly text: string;
    readonly color: string;
}

class RecordingContext implements CanvasCellContext<FakeCanvas>, CanvasGlyphContext {
    public fillStyle: unknown = "";
    public font = "";
    public textBaseline = "";
    public measureCalls = 0;
    public readonly operations: Operation[] = [];
    public readonly slotContents = new Map<string, SlotContent>();
    private clipX = 0;
    private clipY = 0;

    public fillRect(x: number, y: number, width: number, height: number): void {
        this.operations.push({op: "fill", x, y, width, height, color: String(this.fillStyle)});
    }

    public clearRect(x: number, y: number): void {
        this.slotContents.delete(`${x},${y}`);
    }

    public fillText(text: string): void {
        const color = String(this.fillStyle);
        this.slotContents.set(`${this.clipX},${this.clipY}`, {text, color});
        this.operations.push({op: "rasterize", text, color});
    }

    public measureText(): CanvasTextMetrics {
        this.measureCalls++;
        return {width: GLYPH_WIDTH_CSS_PX, fontBoundingBoxAscent: GLYPH_ASCENT_CSS_PX, fontBoundingBoxDescent: GLYPH_DESCENT_CSS_PX};
    }

    public drawImage(image: FakeCanvas, sourceX: number, sourceY: number, _sourceWidth: number, _sourceHeight: number,
                     x: number, y: number, width: number, height: number): void {
        const content = image.context.slotContents.get(`${sourceX},${sourceY}`);
        this.operations.push({op: "glyph", x, y, width, height, text: content?.text, color: content?.color, sourceX, sourceY});
    }

    public save(): void {
    }

    public restore(): void {
    }

    public beginPath(): void {
    }

    public rect(x: number, y: number): void {
        this.clipX = x;
        this.clipY = y;
    }

    public clip(): void {
    }

    public fills(): Fill[] {
        return this.operations.filter((operation): operation is Fill => operation.op === "fill");
    }

    public glyphs(): GlyphDraw[] {
        return this.operations.filter((operation): operation is GlyphDraw => operation.op === "glyph");
    }

    public rasterized(): Rasterize[] {
        return this.operations.filter((operation): operation is Rasterize => operation.op === "rasterize");
    }
}

class FakeCanvas implements CanvasGlyphAtlasCanvas {
    public width = 0;
    public height = 0;
    public readonly context = new RecordingContext();

    public getContext(): RecordingContext {
        return this.context;
    }
}

interface Fixture {
    readonly presenter: CanvasCellPresenter<FakeCanvas>;
    readonly canvas: FakeCanvas;
    readonly screen: RecordingContext;
    readonly atlas: RecordingContext;
    readonly atlasCanvas: FakeCanvas;
}

function fixture(columns: number = COLUMNS, rows: number = ROWS, devicePixelRatio: number = STANDARD_DENSITY): Fixture {
    const canvas = new FakeCanvas();
    const atlasCanvas = new FakeCanvas();
    const presenter = new CanvasCellPresenter<FakeCanvas>({canvas, context: canvas.context, atlasCanvas, devicePixelRatio});
    presenter.resize(columns, rows);
    return {presenter, canvas, screen: canvas.context, atlas: atlasCanvas.context, atlasCanvas};
}

function forgetOperations(target: Fixture): void {
    target.screen.operations.length = 0;
    target.atlas.operations.length = 0;
}

function blankFrame(width: number, height: number, backgroundStyle: CellBackgroundStyle = DEFAULT_STYLE): CellFrame {
    const cells = width * height;
    return {
        width,
        height,
        kind: new Uint8Array(cells),
        glyph: new Uint32Array(cells),
        foreground: new Uint32Array(cells),
        background: new Uint32Array(cells),
        rgb: new Int32Array(cells),
        rgbTop: new Int32Array(cells),
        backgroundStyle,
    };
}

function setRgb(frame: CellFrame, column: number, row: number, rgb: number): void {
    const index = row * frame.width + column;
    frame.kind[index] = CellKind.Rgb;
    frame.rgb[index] = rgb;
}

function setSplit(frame: CellFrame, column: number, row: number, top: number, bottom: number): void {
    const index = row * frame.width + column;
    frame.kind[index] = CellKind.RgbSplit;
    frame.rgbTop[index] = top;
    frame.rgb[index] = bottom;
}

function setText(frame: CellFrame, column: number, row: number, text: string,
                 foreground: TextColor = TextColor.DEFAULT, background: TextColor = TextColor.DEFAULT): void {
    let index = row * frame.width + column;
    for (const character of text) {
        frame.kind[index] = CellKind.Text;
        frame.glyph[index] = character.codePointAt(0)!;
        frame.foreground[index] = foreground;
        frame.background[index] = background;
        index++;
    }
}

function fill(x: number, y: number, width: number, height: number, rgb: number): Fill {
    return {op: "fill", x, y, width, height, color: cssColor(rgb)};
}

function clearsCanvas(target: Fixture): Fill {
    return fill(0, 0, target.canvas.width, target.canvas.height, THEME_BACKGROUND_RGB);
}

function shownGlyphs(context: RecordingContext): {x: number, y: number, text: string | undefined, color: string | undefined}[] {
    return context.glyphs().map(({x, y, text, color}) => ({x, y, text, color}));
}

describe("CanvasCellPresenter geometry", () => {
    test("measures the font once and sizes cells in device pixels from the device pixel ratio", () => {
        const target = fixture(10, 5, DOUBLE_DENSITY);
        expect(target.presenter.cellWidthDevicePx).toBe(CELL_WIDTH * DOUBLE_DENSITY);
        expect(target.presenter.cellHeightDevicePx).toBe(CELL_HEIGHT * DOUBLE_DENSITY);
        expect([target.canvas.width, target.canvas.height]).toEqual([10 * CELL_WIDTH * DOUBLE_DENSITY, 5 * CELL_HEIGHT * DOUBLE_DENSITY]);
        expect(target.atlas.font.startsWith(`${DEFAULT_CANVAS_CELL_FONT.sizeCssPx * DOUBLE_DENSITY}px `)).toBe(true);

        target.presenter.setDevicePixelRatio(STANDARD_DENSITY);
        expect([target.canvas.width, target.canvas.height]).toEqual([10 * CELL_WIDTH, 5 * CELL_HEIGHT]);
        expect([target.atlasCanvas.width, target.atlasCanvas.height])
            .toEqual([GLYPH_ATLAS_SLOT_COLUMNS * CELL_WIDTH, GLYPH_ATLAS_SLOT_ROWS * CELL_HEIGHT]);
        expect(target.screen.measureCalls).toBe(1);
    });

    test("size() and onResize follow resize(), and an unchanged size notifies nobody", () => {
        const target = fixture();
        let notified = 0;
        const stop = target.presenter.onResize(() => notified++);
        target.presenter.resize(COLUMNS, ROWS);
        expect(notified).toBe(0);
        target.presenter.resize(12, 3);
        expect(notified).toBe(1);
        expect(target.presenter.size()).toEqual({columns: 12, rows: 3});
        stop();
        target.presenter.resize(4, 4);
        expect(notified).toBe(1);
    });
});

describe("CanvasCellPresenter backgrounds", () => {
    test("merges horizontal runs of equal colour into one rectangle per run and row", () => {
        const target = fixture();
        const frame = blankFrame(6, 2);
        setRgb(frame, 0, 0, RED);
        setRgb(frame, 1, 0, RED);
        setRgb(frame, 2, 0, RED);
        setRgb(frame, 3, 0, BLUE);
        setRgb(frame, 4, 0, BLUE);
        target.presenter.present(frame);
        expect(target.screen.fills()).toEqual([
            clearsCanvas(target),
            fill(0, 0, 3 * CELL_WIDTH, CELL_HEIGHT, RED),
            fill(3 * CELL_WIDTH, 0, 2 * CELL_WIDTH, CELL_HEIGHT, BLUE),
            fill(5 * CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT, THEME_BACKGROUND_RGB),
            fill(0, CELL_HEIGHT, 6 * CELL_WIDTH, CELL_HEIGHT, THEME_BACKGROUND_RGB),
        ]);
    });

    test("background cells fill the background style's colour and draw its glyph", () => {
        const target = fixture();
        const frame = blankFrame(2, 1, {glyph: DOT, foreground: TextColor.GREEN, background: TextColor.BLUE});
        target.presenter.present(frame);
        expect(target.screen.fills()).toEqual([clearsCanvas(target), fill(0, 0, 2 * CELL_WIDTH, CELL_HEIGHT, PALETTE_BLUE_RGB)]);
        expect(shownGlyphs(target.screen)).toEqual([
            {x: 0, y: 0, text: ".", color: cssColor(paletteRgb(2))},
            {x: CELL_WIDTH, y: 0, text: ".", color: cssColor(paletteRgb(2))},
        ]);
    });
});

describe("CanvasCellPresenter half blocks", () => {
    test("split cells and half or full block glyphs are exact rectangles, never atlas glyphs", () => {
        const target = fixture();
        const frame = blankFrame(4, 1);
        setSplit(frame, 0, 0, RED, BLUE);
        setText(frame, 1, 0, UPPER_HALF_BLOCK, TextColor.rgb(0, 255, 0), TextColor.rgb(0, 0, 255));
        setText(frame, 2, 0, LOWER_HALF_BLOCK, TextColor.rgb(0, 255, 0), TextColor.rgb(0, 0, 255));
        setText(frame, 3, 0, FULL_BLOCK, TextColor.rgb(0, 255, 0), TextColor.rgb(0, 0, 255));
        target.presenter.present(frame);
        expect(target.screen.fills()).toEqual([
            clearsCanvas(target),
            fill(0, 0, CELL_WIDTH, HALF_HEIGHT, RED),
            fill(0, HALF_HEIGHT, CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, BLUE),
            fill(CELL_WIDTH, 0, CELL_WIDTH, HALF_HEIGHT, GREEN),
            fill(CELL_WIDTH, HALF_HEIGHT, CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, BLUE),
            fill(2 * CELL_WIDTH, 0, CELL_WIDTH, HALF_HEIGHT, BLUE),
            fill(2 * CELL_WIDTH, HALF_HEIGHT, CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, GREEN),
            fill(3 * CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT, GREEN),
        ]);
        expect(target.screen.glyphs()).toEqual([]);
        expect(target.atlas.rasterized()).toEqual([]);
    });

    test("adjacent split cells with equal halves merge into one rectangle per half", () => {
        const target = fixture();
        const frame = blankFrame(2, 1);
        setSplit(frame, 0, 0, RED, BLUE);
        setSplit(frame, 1, 0, RED, BLUE);
        target.presenter.present(frame);
        expect(target.screen.fills()).toEqual([
            clearsCanvas(target),
            fill(0, 0, 2 * CELL_WIDTH, HALF_HEIGHT, RED),
            fill(0, HALF_HEIGHT, 2 * CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, BLUE),
        ]);
    });

    test("an uncovered split half shows the background style's background colour", () => {
        const styled = fixture();
        const frame = blankFrame(2, 1, {glyph: SPACE, foreground: TextColor.BLACK, background: TextColor.BLUE});
        setSplit(frame, 0, 0, NO_COLOR, RED);
        setSplit(frame, 1, 0, GREEN, NO_COLOR);
        styled.presenter.present(frame);
        expect(styled.screen.fills()).toEqual([
            clearsCanvas(styled),
            fill(0, 0, CELL_WIDTH, HALF_HEIGHT, PALETTE_BLUE_RGB),
            fill(0, HALF_HEIGHT, CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, RED),
            fill(CELL_WIDTH, 0, CELL_WIDTH, HALF_HEIGHT, GREEN),
            fill(CELL_WIDTH, HALF_HEIGHT, CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, PALETTE_BLUE_RGB),
        ]);

        const themed = fixture();
        const defaultStyled = blankFrame(1, 1);
        setSplit(defaultStyled, 0, 0, RED, NO_COLOR);
        themed.presenter.present(defaultStyled);
        expect(themed.screen.fills().slice(1)).toEqual([
            fill(0, 0, CELL_WIDTH, HALF_HEIGHT, RED),
            fill(0, HALF_HEIGHT, CELL_WIDTH, CELL_HEIGHT - HALF_HEIGHT, THEME_BACKGROUND_RGB),
        ]);
    });
});

describe("CanvasCellPresenter colours", () => {
    test("resolves default, palette and rgb text colours", () => {
        const DEFAULT_RGB = 0x123456;
        expect(textColorRgb(TextColor.DEFAULT, DEFAULT_RGB)).toBe(DEFAULT_RGB);
        expect(textColorRgb(TextColor.RED, DEFAULT_RGB)).toBe(0xCD0000);
        expect(textColorRgb(TextColor.BRIGHT_BLUE, DEFAULT_RGB)).toBe(0x5C5CFF);
        expect(textColorRgb(TextColor.palette(16), DEFAULT_RGB)).toBe(0x000000);
        expect(textColorRgb(TextColor.palette(21), DEFAULT_RGB)).toBe(0x0000FF);
        expect(textColorRgb(TextColor.palette(67), DEFAULT_RGB)).toBe(0x5F87AF);
        expect(textColorRgb(TextColor.palette(231), DEFAULT_RGB)).toBe(0xFFFFFF);
        expect(textColorRgb(TextColor.palette(232), DEFAULT_RGB)).toBe(0x080808);
        expect(textColorRgb(TextColor.palette(255), DEFAULT_RGB)).toBe(0xEEEEEE);
        expect(textColorRgb(TextColor.rgb(1, 2, 3), DEFAULT_RGB)).toBe(0x010203);
    });

    test("text cells use the theme for default colours and resolve palette and rgb colours", () => {
        const target = fixture();
        const frame = blankFrame(2, 1);
        setText(frame, 0, 0, "a");
        setText(frame, 1, 0, "b", TextColor.BRIGHT_RED, TextColor.rgb(0x12, 0x34, 0x56));
        target.presenter.present(frame);
        expect(target.screen.fills().slice(1)).toEqual([
            fill(0, 0, CELL_WIDTH, CELL_HEIGHT, THEME_BACKGROUND_RGB),
            fill(CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT, 0x123456),
        ]);
        expect(shownGlyphs(target.screen)).toEqual([
            {x: 0, y: 0, text: "a", color: cssColor(THEME_FOREGROUND_RGB)},
            {x: CELL_WIDTH, y: 0, text: "b", color: cssColor(0xFF0000)},
        ]);
    });
});

describe("CanvasCellPresenter glyph atlas", () => {
    test("rasterizes each glyph and colour once and draws every cell from its atlas slot", () => {
        const target = fixture();
        const frame = blankFrame(4, 1);
        setText(frame, 0, 0, "aa", TextColor.RED);
        setText(frame, 2, 0, "a", TextColor.GREEN);
        setText(frame, 3, 0, " ", TextColor.RED);
        target.presenter.present(frame);
        expect(target.atlas.rasterized()).toEqual([
            {op: "rasterize", text: "a", color: cssColor(paletteRgb(1))},
            {op: "rasterize", text: "a", color: cssColor(paletteRgb(2))},
        ]);
        const draws = target.screen.glyphs();
        expect(draws.length).toBe(3);
        expect([draws[1].sourceX, draws[1].sourceY]).toEqual([draws[0].sourceX, draws[0].sourceY]);
        expect(shownGlyphs(target.screen)).toEqual([
            {x: 0, y: 0, text: "a", color: cssColor(paletteRgb(1))},
            {x: CELL_WIDTH, y: 0, text: "a", color: cssColor(paletteRgb(1))},
            {x: 2 * CELL_WIDTH, y: 0, text: "a", color: cssColor(paletteRgb(2))},
        ]);

        forgetOperations(target);
        const moved = blankFrame(4, 1);
        setText(moved, 3, 0, "a", TextColor.GREEN);
        target.presenter.present(moved);
        expect(target.atlas.rasterized()).toEqual([]);
        expect(shownGlyphs(target.screen)).toEqual([{x: 3 * CELL_WIDTH, y: 0, text: "a", color: cssColor(paletteRgb(2))}]);
    });

    test("a control character draws the replacement character and a space draws no glyph", () => {
        const target = fixture();
        const frame = blankFrame(2, 1);
        setText(frame, 0, 0, String.fromCodePoint(BELL) + " ");
        target.presenter.present(frame);
        expect(shownGlyphs(target.screen)).toEqual([
            {x: 0, y: 0, text: REPLACEMENT_CHARACTER, color: cssColor(THEME_FOREGROUND_RGB)},
        ]);
    });

    test("a full atlas resets and every cell still shows its own glyph", () => {
        const distinctGlyphs = GLYPH_ATLAS_CAPACITY_GLYPHS + 1;
        const width = GLYPH_ATLAS_SLOT_COLUMNS;
        const height = Math.ceil(distinctGlyphs / width);
        const target = fixture(width, height);
        const frame = blankFrame(width, height);
        const expectedText = (cell: number) => String.fromCodePoint(FIRST_DISTINCT_GLYPH + cell);
        for (let cell = 0; cell < distinctGlyphs; cell++) {
            setText(frame, cell % width, Math.floor(cell / width), expectedText(cell));
        }
        target.presenter.present(frame);

        expect(target.atlas.rasterized().length).toBe(distinctGlyphs);
        const draws = target.screen.glyphs();
        expect(draws.length).toBe(distinctGlyphs);
        const wrong = draws.filter(draw => draw.text !== expectedText(draw.y / CELL_HEIGHT * width + draw.x / CELL_WIDTH));
        expect(wrong).toEqual([]);
        const last = draws[draws.length - 1];
        expect([last.sourceX, last.sourceY]).toEqual([0, 0]);

        forgetOperations(target);
        const evicted = copyCellFrame(frame);
        setText(evicted, 0, 0, expectedText(1));
        target.presenter.present(evicted);
        expect(target.atlas.rasterized()).toEqual([{op: "rasterize", text: expectedText(1), color: cssColor(THEME_FOREGROUND_RGB)}]);
        expect(shownGlyphs(target.screen)).toEqual([{x: 0, y: 0, text: expectedText(1), color: cssColor(THEME_FOREGROUND_RGB)}]);
    });

    test("a changed cell that does not fit the full atlas resets it and repaints everything", () => {
        const width = GLYPH_ATLAS_SLOT_COLUMNS, height = GLYPH_ATLAS_SLOT_ROWS;
        const target = fixture(width, height);
        const frame = blankFrame(width, height);
        const textAt = (cell: number) => String.fromCodePoint(FIRST_DISTINCT_GLYPH + cell);
        for (let cell = 0; cell < GLYPH_ATLAS_CAPACITY_GLYPHS; cell++) setText(frame, cell % width, Math.floor(cell / width), textAt(cell));
        target.presenter.present(frame);
        expect(target.atlas.rasterized().length).toBe(GLYPH_ATLAS_CAPACITY_GLYPHS);

        forgetOperations(target);
        const next = copyCellFrame(frame);
        const unseenText = textAt(GLYPH_ATLAS_CAPACITY_GLYPHS);
        setText(next, 0, 0, unseenText);
        target.presenter.present(next);

        const clear = clearsCanvas(target);
        const coversCanvas = (operation: Fill) => operation.width === clear.width && operation.height === clear.height;
        expect(target.screen.fills().filter(coversCanvas)).toEqual([clear]);
        expect(target.atlas.rasterized().length).toBe(GLYPH_ATLAS_CAPACITY_GLYPHS);
        const draws = target.screen.glyphs();
        expect(draws.length).toBe(GLYPH_ATLAS_CAPACITY_GLYPHS);
        const expectedAt = (cell: number) => cell === 0 ? unseenText : textAt(cell);
        const wrong = draws.filter(draw => draw.text !== expectedAt(draw.y / CELL_HEIGHT * width + draw.x / CELL_WIDTH));
        expect(wrong).toEqual([]);
    });
});

describe("CanvasCellPresenter repaints", () => {
    let target: Fixture;
    let frame: CellFrame;

    beforeEach(() => {
        target = fixture();
        frame = blankFrame(4, 1);
        setText(frame, 0, 0, "ab", TextColor.YELLOW, TextColor.BLUE);
        setRgb(frame, 2, 0, RED);
        target.presenter.present(frame);
        forgetOperations(target);
    });

    test("an identical frame draws nothing", () => {
        target.presenter.present(copyCellFrame(frame));
        expect(target.screen.operations).toEqual([]);
    });

    test("only the cells that changed since the previous frame are repainted", () => {
        const next = copyCellFrame(frame);
        setRgb(next, 2, 0, BLUE);
        setText(next, 1, 0, "c", TextColor.YELLOW, TextColor.BLUE);
        target.presenter.present(next);
        expect(target.screen.fills()).toEqual([
            fill(CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT, PALETTE_BLUE_RGB),
            fill(2 * CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT, BLUE),
        ]);
        expect(shownGlyphs(target.screen)).toEqual([{x: CELL_WIDTH, y: 0, text: "c", color: cssColor(paletteRgb(3))}]);
    });

    test("fields a cell's kind does not use are ignored", () => {
        const next = copyCellFrame(frame);
        next.glyph[3] = DOT;
        next.foreground[3] = TextColor.RED;
        next.rgb[0] = GREEN;
        next.rgbTop[2] = GREEN;
        next.glyph[2] = DOT;
        target.presenter.present(next);
        expect(target.screen.operations).toEqual([]);
    });

    test("a size change, a background style change or a full repaint request repaints everything", () => {
        const wider = blankFrame(5, 1);
        target.presenter.present(wider);
        expect(target.screen.fills()).toEqual([clearsCanvas(target), fill(0, 0, 5 * CELL_WIDTH, CELL_HEIGHT, THEME_BACKGROUND_RGB)]);

        forgetOperations(target);
        target.presenter.present(blankFrame(5, 1, {glyph: SPACE, foreground: TextColor.DEFAULT, background: TextColor.RED}));
        expect(target.screen.fills()).toEqual([clearsCanvas(target), fill(0, 0, 5 * CELL_WIDTH, CELL_HEIGHT, paletteRgb(1))]);

        forgetOperations(target);
        target.presenter.present(copyCellFrame(frame), "full");
        expect(target.screen.fills()[0]).toEqual(clearsCanvas(target));
        expect(shownGlyphs(target.screen).map(glyph => glyph.text)).toEqual(["a", "b"]);
    });

    test("a canvas resize or device pixel ratio change redraws the last frame at once", () => {
        target.presenter.resize(10, 3);
        expect(target.screen.fills()[0]).toEqual(fill(0, 0, 10 * CELL_WIDTH, 3 * CELL_HEIGHT, THEME_BACKGROUND_RGB));
        expect(shownGlyphs(target.screen).map(glyph => glyph.text)).toEqual(["a", "b"]);

        forgetOperations(target);
        target.presenter.setDevicePixelRatio(DOUBLE_DENSITY);
        const cellWidth = CELL_WIDTH * DOUBLE_DENSITY, cellHeight = CELL_HEIGHT * DOUBLE_DENSITY;
        expect(target.screen.fills()).toEqual([
            fill(0, 0, 10 * cellWidth, 3 * cellHeight, THEME_BACKGROUND_RGB),
            fill(0, 0, 2 * cellWidth, cellHeight, PALETTE_BLUE_RGB),
            fill(2 * cellWidth, 0, cellWidth, cellHeight, RED),
            fill(3 * cellWidth, 0, cellWidth, cellHeight, THEME_BACKGROUND_RGB),
        ]);
        expect(target.atlas.rasterized().map(glyph => glyph.text)).toEqual(["a", "b"]);
        expect(shownGlyphs(target.screen)).toEqual([
            {x: 0, y: 0, text: "a", color: cssColor(paletteRgb(3))},
            {x: cellWidth, y: 0, text: "b", color: cssColor(paletteRgb(3))},
        ]);
    });
});
