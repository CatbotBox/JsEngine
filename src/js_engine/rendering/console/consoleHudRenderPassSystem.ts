import {System} from "../../core";
import {Camera} from "../camera";
import {ConsoleScreenBuffer} from "./consoleScreenBuffer";
import {HudElement} from "../hudElement";
import {ScreenSize} from "../screenSize";
import {anchorFractionX, anchorFractionY, ConsoleImageAnchor} from "./consoleImageAnchor";
import {RenderBoundsOffset} from "../renderBoundsOffset";
import {ConsoleImage} from "./consoleImage";
import {ConsoleRenderPassSystemGroup} from "./consoleRenderPassSystemGroup";

const DEFAULT_ANCHOR = new ConsoleImageAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_AFTER_CAMERA_SIZING = 100;

export class ConsoleHudRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([ConsoleImage, HudElement])

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_CAMERA_SIZING;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery)
        this.requireAnyForUpdate(this._hudObjectQuery)
    }

    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            screenSize: ScreenSize,
        });

        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const hudEntities = this._hudObjectQuery
            .stream({
                read: {img: ConsoleImage},
                optional: {offset: RenderBoundsOffset, anchor: ConsoleImageAnchor},
            });

        hudEntities.consume(({img, anchor: rawAnchor, offset: rawOffset}) => {
            const anchor = rawAnchor ?? DEFAULT_ANCHOR;
            const offset = rawOffset ?? DEFAULT_OFFSET;
            const ax = anchorFractionX(anchor.anchorPosition);
            const ay = anchorFractionY(anchor.anchorPosition);

            const screenW = cameraEntity.screenSize.x | 0;
            const screenH = cameraEntity.screenSize.y | 0;

            const sx = Math.floor(ax * (screenW - img.sizeX)) + ((offset?.x ?? 0) | 0);
            const sy = Math.floor(ay * (screenH - img.sizeY)) + ((offset?.y ?? 0) | 0);
            screenBuffer.blit(img, sx, sy, Number.NEGATIVE_INFINITY);
        });
    }


}
