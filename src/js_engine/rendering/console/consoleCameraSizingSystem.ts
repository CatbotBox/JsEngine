import {System} from "../../core";
import {Camera} from "../camera";
import {RenderingSystemGroup} from "../renderingSystemGroup";
import {ScreenSize} from "../screenSize";

/** Keeps the camera's ScreenSize equal to the platform's terminal, minus one row left for the prompt. */
export class ConsoleCameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize])
    private _sizeStale: boolean = true;
    private _stopWatchingResize: (() => void) | undefined;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._cameraQuery)
        this._stopWatchingResize = this.world.platform.screen.onResize(() => {
            this._sizeStale = true;
        });
    }

    protected onDestroy() {
        this._stopWatchingResize?.();
        this._stopWatchingResize = undefined;
    }

    onUpdate() {
        if (!this._sizeStale) return;
        this._sizeStale = false;
        this.refreshSize();
    }

    onEnable(): void {
        this._sizeStale = true;
    }

    public refreshSize() {
        const {columns, rows} = this.world.platform.screen.size();
        const height = rows - 1; // leave one row for the prompt

        const cameraEntity = this._cameraQuery.getSingleton({screenSize: ScreenSize})
        const screenSize = cameraEntity.screenSize;
        // The terminal is the same size on almost every frame, and ScreenSize is
        // a component other systems watch -- writing it anyway is not free.
        if (screenSize.x === columns && screenSize.y === height) return;
        screenSize.x = columns;
        screenSize.y = height;
    }
}
