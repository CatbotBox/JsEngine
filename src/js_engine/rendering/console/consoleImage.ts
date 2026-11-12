import {Component, Entity} from "../../core";
import {EntityWriteOptions} from "../../core/entityWriteOptions";
import {RenderBounds} from "../renderBounds";
import {Ansi} from "./ansi";

export class ConsoleImage extends Component {
    private _image: string[] = []
    public _transparentChar: string | undefined = ' ';
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

    private recalculatePixels() {
        const image = this._image;
        this._pixels.length = image.length;

        let widest = 0;
        for (let row = 0; row < image.length; row++) {
            const line = image[row];
            let out = this._pixels[row];
            if (out === undefined) out = this._pixels[row] = [];
            ConsoleImage.splitIntoGlyphsInto(out, line, this.transparentChar);
            const w = out.length;
            if (w > widest) widest = w;
        }

        this._sizeX = widest;
        this._sizeY = image.length;
    }

    public get pixels(): (string | undefined)[][] {
        return this._pixels;
    }

    private static readonly STICKY_SGR_SEQUENCE = /\x1B\[[0-9;]*m/y;

    private static splitIntoGlyphsInto(out: (string | undefined)[], line: string, transparentChar: string | undefined): void {
        const ESC = "\x1b";
        const sgrSequence = ConsoleImage.STICKY_SGR_SEQUENCE;

        let n = 0;
        let i = 0;
        let pendingStyle = "";

        while (i < line.length) {
            const ch = line[i];

            if (ch === ESC) {
                sgrSequence.lastIndex = i;
                const sgrMatch = sgrSequence.exec(line);
                if (sgrMatch) {
                    pendingStyle += sgrMatch[0];
                    i += sgrMatch[0].length;
                    continue;
                }
                pendingStyle += ch;
                i++;
                continue;
            }

            if (ch === transparentChar)
                out[n++] = undefined;
            else {
                out[n++] = Ansi.control.reset + pendingStyle + ch + Ansi.control.reset;
            }
            i++;
        }

        out.length = n;
    }
}