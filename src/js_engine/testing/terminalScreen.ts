/**
 * The characters a terminal emulator would show for an output stream, modelled on xterm.js with
 * the engine's modes: no tty line discipline (LF moves down without returning, as with
 * `convertEol: false`), autowrap off (after the last column the cursor waits one past it, and the
 * next glyph overwrites the last cell), colours ignored. Only what the engine emits is understood:
 * CUP (`ESC[r;cH`), ED 0 (`ESC[J`), CR, LF; every other escape sequence is skipped.
 * Cells never written, or erased, are `undefined`.
 */
export class TerminalScreen {
    private cells: (string | undefined)[][];
    private x = 0;
    private y = 0;

    public constructor(public columns: number, public rows: number) {
        this.cells = TerminalScreen.blank(columns, rows);
    }

    private static blank(columns: number, rows: number): (string | undefined)[][] {
        return Array.from({length: rows}, () => new Array<string | undefined>(columns).fill(undefined));
    }

    /** Keeps what fits, like a terminal resize without reflow. */
    public resize(columns: number, rows: number): void {
        const next = TerminalScreen.blank(columns, rows);
        for (let y = 0; y < Math.min(rows, this.rows); y++) {
            for (let x = 0; x < Math.min(columns, this.columns); x++) next[y][x] = this.cells[y][x];
        }
        this.cells = next;
        this.columns = columns;
        this.rows = rows;
        this.x = Math.min(this.x, columns - 1);
        this.y = Math.min(this.y, rows - 1);
    }

    public write(data: string): void {
        let i = 0;
        while (i < data.length) {
            const char = data[i];
            if (char === "\x1b") {
                i = this.escape(data, i);
                continue;
            }
            if (char === "\r") this.x = 0;
            else if (char === "\n") this.lineFeed();
            else {
                const codePoint = data.codePointAt(i)!;
                const glyph = String.fromCodePoint(codePoint);
                if (this.x >= this.columns) this.x = this.columns - 1;
                this.cells[this.y][this.x] = glyph;
                this.x++;
                i += glyph.length;
                continue;
            }
            i++;
        }
    }

    /** Cells written in rows [0, rows) and columns [0, columns). */
    public writtenCells(columns: number = this.columns, rows: number = this.rows): number {
        let written = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) if (this.cells[y][x] !== undefined) written++;
        }
        return written;
    }

    public count(glyph: string): number {
        let found = 0;
        for (const row of this.cells) for (const cell of row) if (cell === glyph) found++;
        return found;
    }

    private lineFeed(): void {
        if (this.x >= this.columns) this.x = this.columns - 1;
        if (this.y < this.rows - 1) {
            this.y++;
            return;
        }
        this.cells.shift();
        this.cells.push(new Array<string | undefined>(this.columns).fill(undefined));
    }

    private escape(data: string, start: number): number {
        if (data[start + 1] !== "[") return start + 2;
        let end = start + 2;
        while (end < data.length && !/[@-~]/.test(data[end])) end++;
        const params = data.slice(start + 2, end);
        const final = data[end];
        if (!params.startsWith("?")) {
            if (final === "H") this.moveTo(params);
            else if (final === "J" && (params === "" || params === "0")) this.eraseBelow();
        }
        return end + 1;
    }

    private moveTo(params: string): void {
        const [row, column] = params.split(";").map(value => Number(value) || 1);
        this.y = Math.min(Math.max((row ?? 1) - 1, 0), this.rows - 1);
        this.x = Math.min(Math.max((column ?? 1) - 1, 0), this.columns - 1);
    }

    private eraseBelow(): void {
        for (let x = this.x; x < this.columns; x++) this.cells[this.y][x] = undefined;
        for (let y = this.y + 1; y < this.rows; y++) this.cells[y].fill(undefined);
    }
}
