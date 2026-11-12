import {System} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {CellGrid} from "./cellGrid";
import {HudElement} from "../../engine/rendering/hudElement";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {anchorFractionX, anchorFractionY, ScreenAnchor} from "../../engine/rendering/screenAnchor";
import {RenderBoundsOffset} from "../../engine/rendering/renderBoundsOffset";
import {TextSprite} from "../../engine/rendering/textSprite";
import {CellRenderSystemGroup} from "./cellRenderSystemGroup";

const DEFAULT_ANCHOR = new ScreenAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_AFTER_CAMERA_SIZING = 100;

export class HudTextSpriteCellPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([TextSprite, HudElement])

    override systemGroup() {
        return CellRenderSystemGroup;
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

        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const hudEntities = this._hudObjectQuery
            .stream({
                read: {img: TextSprite},
                optional: {offset: RenderBoundsOffset, anchor: ScreenAnchor},
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
