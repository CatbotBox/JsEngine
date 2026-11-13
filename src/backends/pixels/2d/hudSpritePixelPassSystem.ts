import {System} from "../../../engine/core";
import {Camera} from "../../../engine/rendering/camera";
import {HudElement} from "../../../engine/rendering/hudElement";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {anchorFractionX, anchorFractionY, anchoredStart, ScreenAnchor} from "../../../engine/rendering/screenAnchor";
import {RenderBoundsOffset} from "../../../engine/rendering/renderBoundsOffset";
import {Sprite} from "../../../engine/rendering/2d/sprite";
import {PixelFramebuffer} from "../pixelFramebuffer";
import {PixelRenderSystemGroup} from "../pixelRenderSystemGroup";
import {SpritePixelPassSettings} from "./spritePixelPassSettings";
import {SpritePixelRasterizer, spriteHeightPx, spriteWidthPx} from "./spritePixelRasterizer";

const DEFAULT_ANCHOR = new ScreenAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_BEFORE_TEXT_HUD = 99;
const HUD_DEPTH = Number.NEGATIVE_INFINITY;

export class HudSpritePixelPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([SpritePixelPassSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([Sprite, HudElement]);

    private _rasterizer = new SpritePixelRasterizer();

    override systemGroup() {
        return PixelRenderSystemGroup;
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
        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        if (!framebuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: SpritePixelPassSettings}).settings;
        const unitWidthPx = framebuffer.pixelsPerScreenUnitX, unitHeightPx = framebuffer.pixelsPerScreenUnitY;
        const widthPx = framebuffer.widthPx, heightPx = framebuffer.heightPx;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(framebuffer, settings.toRasterizerConfig());

        this._hudObjectQuery.stream({
            read: {sprite: Sprite},
            optional: {offset: RenderBoundsOffset, anchor: ScreenAnchor},
        }).consume(({sprite, anchor: rawAnchor, offset: rawOffset}) => {
            const image = sprite.image;
            if (image === undefined) return;
            const anchor = rawAnchor ?? DEFAULT_ANCHOR;
            const offset = rawOffset ?? DEFAULT_OFFSET;
            const imageWidthPx = spriteWidthPx(image.sizeX, unitWidthPx);
            const imageHeightPx = spriteHeightPx(image.sizeY, unitHeightPx);
            const x = anchoredStart(anchorFractionX(anchor.anchorPosition), widthPx, imageWidthPx) + Math.floor(offset.x * unitWidthPx);
            const y = anchoredStart(anchorFractionY(anchor.anchorPosition), heightPx, imageHeightPx) + Math.floor(offset.y * unitHeightPx);
            rasterizer.blitSprite(image, x, y, imageWidthPx, imageHeightPx, HUD_DEPTH, sprite.tint, sprite.opacity);
        });
    }
}
