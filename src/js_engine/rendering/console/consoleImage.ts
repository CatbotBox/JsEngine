import {Component, Entity} from "../../core";
import {EntityWriteOptions} from "../../core/entityWriteOptions";
import {RenderBounds} from "../renderBounds";
import {Ansi} from "./ansi";

export class ConsoleImage extends Component {
    private _image: string[] = []
    public _transparentChar: string | undefined = ' ';
    //index format -> [y][x]
    private _pixels: (string | undefined)[][] = [];
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
        this.recalculatePixels();
    }

    public get transparentChar(): string | undefined {
        return this._transparentChar;
    }

    public set transparentChar(value: string | undefined) {
        this._transparentChar = value;
        this.recalculatePixels();
    }

    /**
     * Rebuild the glyph grid. Runs on every `image`/`transparentChar` assignment,
     * which for something like a colour fade is once per entity per frame — so it
     * is worth keeping allocation-free.
     */
    private recalculatePixels() {
        const image = this._image;
        // Reuse the outer array rather than replacing it; rows are replaced below.
        this._pixels.length = image.length;

        let widest = 0;
        for (let row = 0; row < image.length; row++) {
            const line = image[row];
            // Reuse the row array too, not just the outer one: the splitter fills a
            // caller-owned array (the `*Into` out-param convention from
            // math/types/vec.ts) instead of returning a fresh one per row per frame.
            // Measured in bench/tier3.bench.ts: 1.8x at 240x64.
            let out = this._pixels[row];
            if (out === undefined) out = this._pixels[row] = [];
            ConsoleImage.splitIntoGlyphsInto(out, line, this.transparentChar);
            // Visible width == number of glyphs the splitter emitted, so this reuses
            // the work above instead of running Ansi.strip over the line again.
            const w = out.length;
            if (w > widest) widest = w;
        }

        // Was Math.max(...image.map(...)): allocated an array, spread it as arguments
        // (which throws on very wide images), and re-parsed every line.
        this._sizeX = widest;
        this._sizeY = image.length;
    }

    public get pixels(): (string | undefined)[][] {
        return this._pixels;
    }

    // Sticky (/y) so it can be anchored at an index via lastIndex. The previous
    // version did CSI_RE.exec(line.slice(i)) inside the loop, allocating a fresh
    // substring at every escape character — quadratic in the length of an
    // ANSI-heavy line, on a path that runs per entity per frame.
    private static readonly CSI_RE = /\x1B\[[0-9;]*m/y;

    /** Fills `out` with one entry per visible glyph, then truncates it to that length. */
    private static splitIntoGlyphsInto(out: (string | undefined)[], line: string, transparentChar: string | undefined): void {
        const ESC = "\x1b";
        const CSI_RE = ConsoleImage.CSI_RE;

        let n = 0;
        let i = 0;
        let carry = ""; // accumulated ANSI/style for the next visible char

        while (i < line.length) {
            const ch = line[i];

            if (ch === ESC) {
                // Attach SGR sequence to the carry so it applies to the next visible char
                CSI_RE.lastIndex = i;
                const m = CSI_RE.exec(line);
                if (m) {
                    carry += m[0];
                    i += m[0].length;
                    continue;
                }
                // Non-SGR escape: treat as literal
                carry += ch;
                i++;
                continue;
            }

            // Normal visible glyph (NOTE: this is ASCII-safe; for wide chars you could enhance here)
            if (ch === transparentChar)
                out[n++] = undefined;
            else {
                out[n++] = Ansi.control.reset + carry + ch + Ansi.control.reset;
            }
            i++;
        }

        // Any trailing carry without a visible char is ignored intentionally.
        // Truncate rather than rebuild: a shorter line must not leave stale glyphs
        // from the previous frame visible past its end.
        out.length = n;
    }
}