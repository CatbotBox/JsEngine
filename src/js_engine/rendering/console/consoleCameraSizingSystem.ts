import {System} from "../../core";
import {Camera} from "../camera";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {CurrentInterpreter} from "../../interpreter";
import {ScreenSize} from "../screenSize";

export interface RawTerminalSize {
    columns: number;
    rows: number;
}

const FALLBACK_SIZE: RawTerminalSize = {columns: 80, rows: 24};

export function getRawTerminalSize(): RawTerminalSize {
    if (CurrentInterpreter == "Bun") {
        // @ts-ignore
        process.stdout._refreshSize?.();
    }

    if (process.stdout?.isTTY) {
        return {columns: process.stdout.columns, rows: process.stdout.rows};
    }
    if (process.stderr?.isTTY) {
        return {columns: process.stderr.columns, rows: process.stderr.rows};
    }

    const cols = Number(process.env.COLUMNS);
    const rows = Number(process.env.LINES || process.env.ROWS);
    return {
        columns: Number.isFinite(cols) ? cols : FALLBACK_SIZE.columns,
        rows: Number.isFinite(rows) ? rows : FALLBACK_SIZE.rows,
    };
}
export class ConsoleCameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize])
    private _initialized: boolean = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._cameraQuery)
        if (CurrentInterpreter == "Node" || CurrentInterpreter == "Unknown") {
            if (process.stdout.isTTY) {
                process.stdout.on('resize', () => {
                    const cameraEntity = this._cameraQuery.getSingleton({screenSize: ScreenSize})
                    cameraEntity.screenSize.x = process.stdout.columns;
                    cameraEntity.screenSize.y = process.stdout.rows - 1; // leave one row for the prompt
                    console.log("Resize: " + JSON.stringify(cameraEntity.screenSize, null, 2));
                });
            }
        }
    }

    onUpdate() {
        if (CurrentInterpreter == "Bun" || CurrentInterpreter == "Unknown") {
            this.refreshSize();
            return;
        }
        if (!this._initialized) {
            this.refreshSize();
            this._initialized = true;
        }
    }

    onEnable(): void {
        //reset initialized status
        this._initialized = false;
    }

    public refreshSize() {
        if (CurrentInterpreter == "Bun") {
            // @ts-ignore
            process.stdout._refreshSize();
        }
        const cameraEntity = this._cameraQuery.getSingleton({screenSize: ScreenSize})

        const {columns, rows} = getRawTerminalSize();
        cameraEntity.screenSize.x = columns;
        cameraEntity.screenSize.y = rows - 1; // leave one row for the prompt

        console.log("Resize: " + JSON.stringify(cameraEntity.screenSize, null, 2));
    }
}