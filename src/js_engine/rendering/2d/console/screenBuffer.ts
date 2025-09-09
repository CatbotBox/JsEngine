import {Size2d} from "../size2d";
import {Ansi} from "./ansi";

export class ScreenBuffer {
    private width = 0;
    private height = 0;
    private cells: string[][] = [];
    public screenBuffer: string = "";

    /**
     * (Re)initialize the backing 2D cell array with the given background char.
     */
    public render({consoleSize}: { consoleSize: Size2d }, backgroundChar: string) {
        this.width = Math.max(0, consoleSize.x | 0);
        this.height = Math.max(0, consoleSize.y | 0);
        this.cells = Array.from({length: this.height}, () =>
            Array.from({length: this.width}, () => backgroundChar)
        );
        this.screenBuffer = "";
    }

    /**
     * Blit ANSI-decorated image lines at a destination top-left in SCREEN space.
     * Clipped automatically to the current buffer.
     */
    public blit(lines: string[], dstX: number, dstY: number) {
        if (!this.cells.length) return;

        for (let row = 0; row < lines.length; row++) {
            const y = dstY + row;
            if (y < 0 || y >= this.height) continue;

            const tokens = ScreenBuffer.splitIntoGlyphs(lines[row]); // 1 token == 1 visible glyph (ANSI included)
            for (let col = 0; col < tokens.length; col++) {
                const x = dstX + col;
                if (x < 0 || x >= this.width) continue;
                this.cells[y][x] = tokens[col];
            }
        }
    }

    /**
     * Finalize the current cells to a screen string.
     */
    public flush(): string {
        const lines = this.cells.map(row => row.join(''));
        this.screenBuffer = lines.join('\n') + Ansi.control.reset;
        return this.screenBuffer;
    }

    /**
     * Split a line that may contain ANSI SGR codes into tokens,
     * each token rendering as exactly one visible character.
     */
    private static splitIntoGlyphs(line: string): string[] {
        const ESC = "\x1b";
        const CSI_RE = /^\x1B\[[0-9;]*m/;

        const out: string[] = [];
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
            out.push(carry + ch);
            carry = "";
            i++;
        }

        // Any trailing carry without a visible char is ignored intentionally.
        return out;
    }
}