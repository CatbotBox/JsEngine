/**
 * The characters a terminal emulator would show for an output stream, modelled on xterm.js with
 * the engine's modes: no tty line discipline (LF moves down without returning, as with
 * `convertEol: false`), autowrap off (after the last column the cursor waits one past it, and the
 * next glyph overwrites the last cell). Colour is kept as one bit per cell: whether the cell shows
 * a 24-bit colour (a truecolor background, or a non-space glyph in a truecolor foreground), which
 * is what the 3D pass paints and palette backgrounds and HUD text are not. Only what the engine
 * emits is understood: CUP (`ESC[r;cH`), ED 0 (`ESC[J`), SGR colours, CR, LF; every other escape
 * sequence is skipped. Cells never written, or erased, are `undefined`.
 */
export class TerminalScreen {
    private cells: (string | undefined)[][];
    private truecolor: boolean[][];
    private x = 0;
    private y = 0;
    private foregroundRgb = false;
    private backgroundRgb = false;

    public constructor(public columns: number, public rows: number) {
        this.cells = TerminalScreen.blank(columns, rows);
        this.truecolor = TerminalScreen.blankColors(columns, rows);
    }

    private static blank(columns: number, rows: number): (string | undefined)[][] {
        return Array.from({length: rows}, () => new Array<string | undefined>(columns).fill(undefined));
    }

    private static blankColors(columns: number, rows: number): boolean[][] {
        return Array.from({length: rows}, () => new Array<boolean>(columns).fill(false));
    }

    /** Keeps what fits, like a terminal resize without reflow. */
    public resize(columns: number, rows: number): void {
        const next = TerminalScreen.blank(columns, rows);
        const nextColors = TerminalScreen.blankColors(columns, rows);
        for (let y = 0; y < Math.min(rows, this.rows); y++) {
            for (let x = 0; x < Math.min(columns, this.columns); x++) {
                next[y][x] = this.cells[y][x];
                nextColors[y][x] = this.truecolor[y][x];
            }
        }
        this.cells = next;
        this.truecolor = nextColors;
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
                this.truecolor[this.y][this.x] = this.backgroundRgb || (glyph !== " " && this.foregroundRgb);
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

    /** Cells showing a 24-bit colour (see the class comment). */
    public truecolorCells(): number {
        let found = 0;
        for (const row of this.truecolor) for (const cell of row) if (cell) found++;
        return found;
    }

    /** What the screen shows now, one line per row, cells never written as spaces. */
    public text(): string {
        return this.cells.map(row => row.map(cell => cell ?? " ").join("")).join("\n");
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
        this.truecolor.shift();
        this.truecolor.push(new Array<boolean>(this.columns).fill(false));
    }

    private escape(data: string, start: number): number {
        if (data[start + 1] !== "[") return start + 2;
        let end = start + 2;
        while (end < data.length && !/[@-~]/.test(data[end])) end++;
        const params = data.slice(start + 2, end);
        const final = data[end];
        if (!params.startsWith("?")) {
            if (final === "H") this.moveTo(params);
            else if (final === "m") this.selectGraphicRendition(params);
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
        for (let x = this.x; x < this.columns; x++) {
            this.cells[this.y][x] = undefined;
            this.truecolor[this.y][x] = false;
        }
        for (let y = this.y + 1; y < this.rows; y++) {
            this.cells[y].fill(undefined);
            this.truecolor[y].fill(false);
        }
    }

    private selectGraphicRendition(params: string): void {
        const codes = params === "" ? [0] : params.split(";").map(Number);
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            if (code === 0) {
                this.foregroundRgb = false;
                this.backgroundRgb = false;
            } else if (code === 38 || code === 48) {
                const rgb = codes[i + 1] === 2;
                if (code === 38) this.foregroundRgb = rgb;
                else this.backgroundRgb = rgb;
                i += rgb ? 4 : 2;
            } else if ((code >= 30 && code <= 37) || code === 39 || (code >= 90 && code <= 97)) {
                this.foregroundRgb = false;
            } else if ((code >= 40 && code <= 47) || code === 49 || (code >= 100 && code <= 107)) {
                this.backgroundRgb = false;
            }
        }
    }
}
