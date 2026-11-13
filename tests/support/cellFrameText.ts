import {CellKind, NO_COLOR} from "../../src/backends/cells";
import type {CellFrame} from "../../src/backends/cells";

const UPPER_HALF_BLOCK = "▀";
const LOWER_HALF_BLOCK = "▄";
const RGB_CELL_GLYPH = " ";

function cellText(frame: CellFrame, idx: number): string {
    switch (frame.kind[idx]) {
        case CellKind.Text:
            return String.fromCodePoint(frame.glyph[idx]);
        case CellKind.Rgb:
            return RGB_CELL_GLYPH;
        case CellKind.RgbSplit:
            return frame.rgbTop[idx] !== NO_COLOR ? UPPER_HALF_BLOCK : LOWER_HALF_BLOCK;
        default:
            return String.fromCodePoint(frame.backgroundStyle.glyph);
    }
}

export function cellFrameLines(frame: CellFrame): string[] {
    return Array.from({length: frame.height}, (_, y) => {
        let line = "";
        for (let x = 0; x < frame.width; x++) line += cellText(frame, y * frame.width + x);
        return line;
    });
}

export function rgbCellCount(frame: CellFrame): number {
    let found = 0;
    for (const kind of frame.kind) if (kind === CellKind.Rgb || kind === CellKind.RgbSplit) found++;
    return found;
}
