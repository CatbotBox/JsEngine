import {glyphColumnsOf, lineColumns, textLines} from "./textColumns";

const WORD_SEPARATOR = " ";
const MIN_WRAP_COLUMNS = 1;

function hardBrokenPieces(word: string, widthColumns: number): string[] {
    const pieces: string[] = [];
    let piece = "";
    let pieceColumns = 0;
    for (const glyph of word) {
        const columns = glyphColumnsOf(glyph.codePointAt(0)!);
        if (pieceColumns + columns > widthColumns && piece.length > 0) {
            pieces.push(piece);
            piece = "";
            pieceColumns = 0;
        }
        piece += glyph;
        pieceColumns += columns;
    }
    pieces.push(piece);
    return pieces;
}

function wrapParagraph(paragraph: string, widthColumns: number, out: string[]): void {
    const words = paragraph.split(WORD_SEPARATOR).filter(word => word.length > 0);
    let line = "";
    let lineWidth = 0;
    for (const word of words) {
        const wordColumns = lineColumns(word);
        if (lineWidth > 0 && lineWidth + WORD_SEPARATOR.length + wordColumns <= widthColumns) {
            line += WORD_SEPARATOR + word;
            lineWidth += WORD_SEPARATOR.length + wordColumns;
            continue;
        }
        if (lineWidth > 0) out.push(line);
        const pieces = wordColumns > widthColumns ? hardBrokenPieces(word, widthColumns) : [word];
        for (let i = 0; i < pieces.length - 1; i++) out.push(pieces[i]);
        line = pieces[pieces.length - 1];
        lineWidth = lineColumns(line);
    }
    out.push(line);
}

export function wrapTextLines(text: string, widthUnits: number): string[] {
    const widthColumns = Math.max(MIN_WRAP_COLUMNS, Math.floor(widthUnits));
    const lines: string[] = [];
    for (const paragraph of textLines(text)) wrapParagraph(paragraph, widthColumns, lines);
    return lines;
}
