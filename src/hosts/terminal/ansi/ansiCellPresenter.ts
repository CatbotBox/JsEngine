import type {CellFrame} from "../../../backends/cells/cellFrame";
import type {CellPresenter, CellPresenterSize, CellRepaint} from "../../../backends/cells/cellPresenter";
import {consoleOverride} from "../../../engine/debugging";
import {originalConsole as display} from "../../../engine/debugging/originalConsole";
import type {TerminalOutput} from "../terminalOutput";
import {AnsiCellEncoder} from "./ansiCellEncoder";
import {Ansi} from "./ansiEncoding";

const CURSOR_HOME = "\x1b[H";
const ERASE_BELOW_CURSOR = "\x1b[J";
const AUTOWRAP_OFF = "\x1b[?7l";
const AUTOWRAP_ON = "\x1b[?7h";
const CRLF = "\r\n";
const FIRST_COLUMN = 1;

export class AnsiCellPresenter implements CellPresenter {
    private readonly encoder = new AnsiCellEncoder();
    private previousRows: string[] = [];
    private previousWidth = -1;

    public constructor(private readonly terminal: TerminalOutput) {
    }

    public size(): CellPresenterSize {
        return this.terminal.size();
    }

    public onResize(listener: () => void): () => void {
        return this.terminal.onResize(listener);
    }

    public backlogged(): boolean {
        return this.terminal.backlogged?.() === true;
    }

    public start(): void {
        consoleOverride.removeConsoleEventListener(display);
        this.terminal.write(Ansi.modes.altScreenEnter);
        this.terminal.write(Ansi.cursor.hide);
        this.terminal.write(AUTOWRAP_OFF);
    }

    public stop(): void {
        consoleOverride.addConsoleEventListener(display);
        this.terminal.write(AUTOWRAP_ON);
        this.terminal.write(Ansi.cursor.show);
        this.terminal.write(Ansi.modes.altScreenExit);
    }

    public dispose(): void {
        display.clear();
    }

    public present(frame: CellFrame, repaint: CellRepaint): void {
        const rows = this.encoder.encodeRows(frame);
        const previousRows = this.previousRows;
        const fullRedraw = repaint === "full"
            || rows.length !== previousRows.length
            || frame.width !== this.previousWidth;

        let out = "";
        if (fullRedraw) {
            out = CURSOR_HOME + rows.join(CRLF) + CRLF + ERASE_BELOW_CURSOR;
        } else {
            for (let y = 0; y < rows.length; y++) {
                if (rows[y] !== previousRows[y]) {
                    out += Ansi.cursor.position(y + 1, FIRST_COLUMN) + rows[y];
                }
            }
        }

        if (out.length > 0) this.terminal.write(out);

        this.previousRows = rows;
        this.previousWidth = frame.width;
    }
}
