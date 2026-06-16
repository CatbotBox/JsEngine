import {System} from "../../core";
import {Camera} from "../camera";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {CurrentInterpreter} from "../../interpreter";
import {ConsoleCellRatio} from "../consoleCellRatio";
import {getRawTerminalSize} from "./consoleCameraSizingSystem";


const DEFAULT_CELL_RATIO = 0.5;
const QUERY_TIMEOUT_MS = 200;

export class ConsoleCellSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ConsoleCellRatio])
    private _initialized: boolean = false;
    private _pending: boolean = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._cameraQuery)
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
        // reset initialized status
        this._initialized = false;
    }

    public refreshSize() {
        if (this._pending) return;

        const cameraEntity = this._cameraQuery.getSingleton({consoleSizeRatio: ConsoleCellRatio});
        const stdin = process.stdin;
        const stdout = process.stdout;

        if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
            cameraEntity.consoleSizeRatio.value = DEFAULT_CELL_RATIO;
            return;
        }

        const {columns: cols, rows} = getRawTerminalSize();

        if (!cols || !rows) {
            cameraEntity.consoleSizeRatio.value = DEFAULT_CELL_RATIO;
            return;
        }

        this._pending = true;
        let buffer = "";
        let settled = false;

        const cleanup = () => {
            stdin.setRawMode(false);
            stdin.pause();
            // noinspection TypeScriptValidateTypes
            stdin.removeListener("data", onData);
            clearTimeout(timer);
            this._pending = false;
        };

        const finish = (ratio: number) => {
            if (settled) return;
            settled = true;
            cameraEntity.consoleSizeRatio.value = ratio;
            cleanup();
        };

        const onData = (chunk: Uint8Array) => {
            buffer += new TextDecoder().decode(chunk);
            const match = buffer.match(/\x1b\[4;(\d+);(\d+)t/);
            if (!match) return;

            const pixelHeight = parseInt(match[1], 10);
            const pixelWidth = parseInt(match[2], 10);

            if (pixelHeight > 0 && pixelWidth > 0) {
                // pixelWidth/pixelHeight describe the WHOLE window — divide
                // out the grid size to get one cell's dimensions, then take
                // ITS width:height ratio.
                const cellWidth = pixelWidth / cols;
                const cellHeight = pixelHeight / rows;
                finish(cellHeight / cellWidth);
            } else {
                // Some terminals/multiplexers (e.g. tmux) reply "0;0" when
                // they don't actually track pixel size.
                finish(DEFAULT_CELL_RATIO);
            }
        };

        const timer = setTimeout(() => {
            // Terminal never replied (no XTWINOPS support) - don't hang forever.
            finish(DEFAULT_CELL_RATIO);
        }, QUERY_TIMEOUT_MS);

        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
        stdout.write('\x1b[14t');
    }
}