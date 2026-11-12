import {EntityCommandBuffer, System} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {CellAspectRatio} from "./cellAspectRatio";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {ScreenSize} from "../../engine/rendering/screenSize";

const PROMPT_ROWS = 1;

export class CellCameraSizingSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize])
    private _camerasWithoutCellRatioQuery = this.createEntityQuery([Camera], [CellAspectRatio])
    private _cellRatioCommands = new EntityCommandBuffer();
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
        this.addMissingCellRatios();
        if (!this._sizeStale) return;
        this._sizeStale = false;
        this.refreshSize();
    }

    onEnable(): void {
        this._sizeStale = true;
    }

    private addMissingCellRatios() {
        if (!this._camerasWithoutCellRatioQuery.hasEntity()) return;
        for (const camera of this._camerasWithoutCellRatioQuery) {
            this._cellRatioCommands.addComponent(camera, new CellAspectRatio());
        }
        this._cellRatioCommands.playback(this.entityManager);
    }

    public refreshSize() {
        const {columns, rows} = this.world.platform.screen.size();
        const height = rows - PROMPT_ROWS;

        const cameraEntity = this._cameraQuery.getSingleton({screenSize: ScreenSize})
        const screenSize = cameraEntity.screenSize;
        if (screenSize.x === columns && screenSize.y === height) return;
        screenSize.x = columns;
        screenSize.y = height;
    }
}
