import {System} from "../../../engine/core";
import type {RenderPassKind} from "../../../engine/rendering/renderPasses";
import {Camera} from "../../../engine/rendering/camera";
import {CellGrid} from "../cellGrid";
import {HudElement} from "../../../engine/rendering/hudElement";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {RenderCameraOverride, renderCameraComponents} from "../../../engine/rendering/renderCameraOverride";
import {anchorFractionX, anchorFractionY, ScreenAnchor} from "../../../engine/rendering/screenAnchor";
import {RenderBoundsOffset} from "../../../engine/rendering/renderBoundsOffset";
import {CellRenderSystemGroup} from "../cellRenderSystemGroup";
import {Sprite} from "../../../engine/rendering/2d/sprite";
import {SpriteCellPassSettings} from "./spriteCellPassSettings";
import {SpriteCellRasterizer} from "./spriteCellRasterizer";

const CAMERA_SPEC = {screenSize: ScreenSize};
const DEFAULT_ANCHOR = new ScreenAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_BEFORE_TEXT_HUD = 99;
const HALF_ROWS_PER_CELL = 2;

export class HudSpriteCellPassSystem extends System {
    public static readonly renderPass: RenderPassKind = "hudSprites";

    private _settingsQuery = this.createEntityQuery([SpriteCellPassSettings]);
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
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride);
        this.requireAnyForUpdate(this._hudObjectQuery);
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: SpriteCellPassSettings}).settings;
        const cameraEntity = renderCameraComponents(this.world, this._cameraQuery, CAMERA_SPEC);
        if (cameraEntity === undefined) return;
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
