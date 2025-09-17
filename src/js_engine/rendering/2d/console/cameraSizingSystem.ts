import {System} from "../../../core";
import {Camera} from "../../camera";
import {RenderingSystemGroup} from "../../RenderingSystemGroup";
import {ScreenSize} from "./components";

export class CameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize])
    private _initialized: boolean = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._cameraQuery)
        if (process.stdout.isTTY) {
            process.stdout.on('resize', () => {
                const cameraEntity = this._cameraQuery.getSingleton({screenSize: ScreenSize})
                cameraEntity.screenSize.x = process.stdout.columns;
                cameraEntity.screenSize.y = process.stdout.rows - 1; // leave one row for the prompt
                console.log("Resize: " + JSON.stringify(cameraEntity.screenSize, null, 2));
            });
        }
    }

    onUpdate() {
        if (!this._initialized) {
            this.refreshSize();
            this._initialized = true;
        }
    }

    protected onEnable() {
        //reset initialized status
        this._initialized = false;
    }

    public refreshSize() {
        const defaultSize = {columns: 24, rows: 80};
        const cameraEntity = this._cameraQuery.getSingleton({screenSize: ScreenSize})

        if (process.stdout && process.stdout.isTTY) {
            cameraEntity.screenSize.x = process.stdout.columns;
            cameraEntity.screenSize.y = process.stdout.rows - 1; // leave one row for the prompt
            return
        }
        if (process.stderr && process.stderr.isTTY) {
            cameraEntity.screenSize.x = process.stderr.columns;
            cameraEntity.screenSize.y = process.stderr.rows - 1; // leave one row for the prompt
            return
        }

        // last-resort: typical env vars on Unix-like systems
        const cols = Number(process.env.COLUMNS);
        const rows = Number(process.env.LINES || process.env.ROWS);
        cameraEntity.screenSize.x = Number.isFinite(cols) ? cols : defaultSize.columns;
        cameraEntity.screenSize.y = (Number.isFinite(rows) ? rows : defaultSize.rows) - 1; // leave one row for the prompt

        console.log("Resize: " + JSON.stringify(cameraEntity.screenSize, null, 2));
    }
}