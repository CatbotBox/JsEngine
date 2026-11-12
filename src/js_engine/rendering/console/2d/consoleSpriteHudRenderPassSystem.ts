import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer} from "../consoleScreenBuffer";
import {HudElement} from "../../hudElement";
import {ScreenSize} from "../../screenSize";
import {anchorFractionX, anchorFractionY, ConsoleImageAnchor} from "../consoleImageAnchor";
import {RenderBoundsOffset} from "../../renderBoundsOffset";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {Sprite} from "../../2d/sprite";
import {Console2DRenderSettings} from "./console2DRenderSettings";
import {SpriteRasterizer} from "./spriteRasterizer";

const DEFAULT_ANCHOR = new ConsoleImageAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_BEFORE_TEXT_HUD = 99;
const HALF_ROWS_PER_CELL = 2;

export class ConsoleSpriteHudRenderPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([Console2DRenderSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([Sprite, HudElement]);

    private _rasterizer = new SpriteRasterizer();

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
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
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: Console2DRenderSettings}).settings;
        const cameraEntity = this._cameraQuery.getSingleton({
            screenSize: ScreenSize,
        });
        const screenW = cameraEntity.screenSize.x | 0;
        const screenH = cameraEntity.screenSize.y | 0;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(dualScreenBuffer.screenBuffer, screenW, screenH, settings.toRasterizerConfig());

        this._hudObjectQuery.stream({
            read: {sprite: Sprite},
            optional: {offset: RenderBoundsOffset, anchor: ConsoleImageAnchor},
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
