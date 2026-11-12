const ESC = "\x1b";
const CSI = "\x1b[";
const SGR_RESET = 0;
const SGR_EXTENDED_FOREGROUND = 38;
const SGR_EXTENDED_BACKGROUND = 48;
const SGR_EXTENDED_RGB_MODE = 2;
const SGR_EXTENDED_RGB_ARGUMENTS = 4;
const SGR_EXTENDED_PALETTE_ARGUMENTS = 2;
const SGR_FOREGROUND_FIRST = 30;
const SGR_FOREGROUND_LAST = 37;
const SGR_DEFAULT_FOREGROUND = 39;
const SGR_BRIGHT_FOREGROUND_FIRST = 90;
const SGR_BRIGHT_FOREGROUND_LAST = 97;
const SGR_BACKGROUND_FIRST = 40;
const SGR_BACKGROUND_LAST = 47;
const SGR_DEFAULT_BACKGROUND = 49;
const SGR_BRIGHT_BACKGROUND_FIRST = 100;
const SGR_BRIGHT_BACKGROUND_LAST = 107;

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
            if (char === ESC) {
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

    public writtenCells(columns: number = this.columns, rows: number = this.rows): number {
        let written = 0;
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < columns; x++) if (this.cells[y][x] !== undefined) written++;
        }
        return written;
    }

    public truecolorCells(): number {
        let found = 0;
        for (const row of this.truecolor) for (const cell of row) if (cell) found++;
        return found;
    }

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
        if (data[start + 1] !== "[") return start + CSI.length;
        let end = start + CSI.length;
        while (end < data.length && !/[@-~]/.test(data[end])) end++;
        const params = data.slice(start + CSI.length, end);
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
        const codes = params === "" ? [SGR_RESET] : params.split(";").map(Number);
        for (let i = 0; i < codes.length; i++) {
            const code = codes[i];
            if (code === SGR_RESET) {
                this.foregroundRgb = false;
                this.backgroundRgb = false;
            } else if (code === SGR_EXTENDED_FOREGROUND || code === SGR_EXTENDED_BACKGROUND) {
                const rgb = codes[i + 1] === SGR_EXTENDED_RGB_MODE;
                if (code === SGR_EXTENDED_FOREGROUND) this.foregroundRgb = rgb;
                else this.backgroundRgb = rgb;
                i += rgb ? SGR_EXTENDED_RGB_ARGUMENTS : SGR_EXTENDED_PALETTE_ARGUMENTS;
            } else if ((code >= SGR_FOREGROUND_FIRST && code <= SGR_FOREGROUND_LAST) || code === SGR_DEFAULT_FOREGROUND
                || (code >= SGR_BRIGHT_FOREGROUND_FIRST && code <= SGR_BRIGHT_FOREGROUND_LAST)) {
                this.foregroundRgb = false;
            } else if ((code >= SGR_BACKGROUND_FIRST && code <= SGR_BACKGROUND_LAST) || code === SGR_DEFAULT_BACKGROUND
                || (code >= SGR_BRIGHT_BACKGROUND_FIRST && code <= SGR_BRIGHT_BACKGROUND_LAST)) {
                this.backgroundRgb = false;
            }
        }
    }
}
