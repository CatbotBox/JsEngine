const COLUMNS_PER_GLYPH = 1;
const LINE_BREAK = "\n";

export interface TextExtent {
    readonly columns: number;
    readonly lines: number;
}

export function glyphColumnsOf(_codePoint: number): number {
    return COLUMNS_PER_GLYPH;
}

export function lineColumns(line: string): number {
    let columns = 0;
    for (const glyph of line) columns += glyphColumnsOf(glyph.codePointAt(0)!);
    return columns;
}

export function textLines(text: string): string[] {
    return text.split(LINE_BREAK);
}

export function measureTextExtent(text: string): TextExtent {
    const lines = textLines(text);
    let columns = 0;
    for (const line of lines) columns = Math.max(columns, lineColumns(line));
    return {columns, lines: lines.length};
}
