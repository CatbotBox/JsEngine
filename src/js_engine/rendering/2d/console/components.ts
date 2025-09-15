import {Component} from "../../../core";
import {Scale} from "../../../translation/scale";
import {Ansi} from "./ansi";

export class ConsoleImageAnchor extends Component {
  public anchorPosition: `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}` = 'middle-center';
}

export class ConsoleImageOffset extends Component {
  public x: number = 0;
  public y: number = 0;
}

export class ConsoleImage extends Component {
  private _image: string[] = []
  public _transparentChar: string | undefined = ' ';
  //index format -> [y][x]
  private _pixels: (string | undefined)[][] = [];

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
    this._pixels = [];
    for (let row = 0; row < this._image.length; row++) {
      this._pixels.push(ConsoleImage.splitIntoGlyphs(this._image[row], this.transparentChar)); // 1 token == 1 visible glyph (ANSI included)
    }
  }

  public get pixels(): (string | undefined)[][] {
    return this._pixels;
  }


  public get size(): Scale {
    const size = new Scale();
    size.x = Math.max(...this.image.map(i => Ansi.strip(i).length));
    size.y = this.image.length;
    return size;
  }

  private static splitIntoGlyphs(line: string, transparentChar: string | undefined): (string | undefined) [] {
    const ESC = "\x1b";
    const CSI_RE = /^\x1B\[[0-9;]*m/;

    const out: (string | undefined)[] = [];
    let i = 0;
    let carry = ""; // accumulated ANSI/style for the next visible char

    while (i < line.length) {
      const ch = line[i];

      if (ch === ESC) {
        // Attach SGR sequence to the carry so it applies to the next visible char
        const m = CSI_RE.exec(line.slice(i));
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
        out.push(undefined);
      else {
        out.push(carry + ch + Ansi.control.reset);
      }
      i++;
    }

    // Any trailing carry without a visible char is ignored intentionally.
    return out;
  }
}