import {System} from "../../../engine/core";
import {Camera} from "../../../engine/rendering/camera";
import {CellGrid} from "../cellGrid";
import {HudElement} from "../../../engine/rendering/hudElement";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {anchorFractionX, anchorFractionY, ScreenAnchor} from "../../../engine/rendering/screenAnchor";
import {RenderBoundsOffset} from "../../../engine/rendering/renderBoundsOffset";
import {CellRenderSystemGroup} from "../cellRenderSystemGroup";
import {Sprite} from "../../../engine/rendering/2d/sprite";
import {TextSpriteCellPassSettings} from "./textSpriteCellPassSettings";
import {SpriteCellRasterizer} from "./spriteCellRasterizer";

const DEFAULT_ANCHOR = new ScreenAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_BEFORE_TEXT_HUD = 99;
const HALF_ROWS_PER_CELL = 2;

export class HudSpriteCellPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([TextSpriteCellPassSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([Sprite, HudElement]);

    private _rasterizer = new SpriteCellRasterizer();

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    override priority(): number {
        return PRIORITY_BEFORE_TEXT_HUD;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._hudObjectQuery);
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: TextSpriteCellPassSettings}).settings;
        const cameraEntity = this._cameraQuery.getSingleton({
            screenSize: ScreenSize,
        });
        const screenW = cameraEntity.screenSize.x | 0;
        const screenH = cameraEntity.screenSize.y | 0;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(dualScreenBuffer.screenBuffer, screenW, screenH, settings.toRasterizerConfig());

        this._hudObjectQuery.stream({
            read: {sprite: Sprite},
            optional: {offset: RenderBoundsOffset, anchor: ScreenAnchor},
        }).consume(({sprite, anchor: rawAnchor, offset: rawOffset}) => {
            const image = sprite.image;
            if (image === undefined) return;
            const anchor = rawAnchor ?? DEFAULT_ANCHOR;
            const offset = rawOffset ?? DEFAULT_OFFSET;
            const ax = anchorFractionX(anchor.anchorPosition);
            const ay = anchorFractionY(anchor.anchorPosition);

            const sx = Math.floor(ax * (screenW - image.sizeX)) + ((offset?.x ?? 0) | 0);
            const halfRowY = Math.floor(ay * (screenH * HALF_ROWS_PER_CELL - image.sizeY)) + (((offset?.y ?? 0) | 0) * HALF_ROWS_PER_CELL);
            rasterizer.blitSprite(image, sx, halfRowY, Number.NEGATIVE_INFINITY, sprite.tint, sprite.opacity);
        });

        rasterizer.endFrame();
    }
}
