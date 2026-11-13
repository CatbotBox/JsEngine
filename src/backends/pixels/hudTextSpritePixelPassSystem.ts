import {System} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {HudElement} from "../../engine/rendering/hudElement";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {anchorFractionX, anchorFractionY, anchoredStart, ScreenAnchor} from "../../engine/rendering/screenAnchor";
import {RenderBoundsOffset} from "../../engine/rendering/renderBoundsOffset";
import {TextSprite} from "../../engine/rendering/textSprite";
import {PixelFramebuffer} from "./pixelFramebuffer";
import {PixelRenderSystemGroup} from "./pixelRenderSystemGroup";
import {PixelTextRasterizer} from "./pixelTextRasterizer";

const DEFAULT_ANCHOR = new ScreenAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();
const PRIORITY_AFTER_HUD_SPRITES = 100;
const HUD_DEPTH = Number.NEGATIVE_INFINITY;

export class HudTextSpritePixelPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([TextSprite, HudElement]);

    private _text = new PixelTextRasterizer();

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    override priority(): number {
        return PRIORITY_AFTER_HUD_SPRITES;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._hudObjectQuery);
    }

    onUpdate() {
        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        if (!framebuffer) return;
        const unitWidthPx = framebuffer.pixelsPerScreenUnitX, unitHeightPx = framebuffer.pixelsPerScreenUnitY;
        const widthPx = framebuffer.widthPx, heightPx = framebuffer.heightPx;

        this._hudObjectQuery.stream({
            read: {img: TextSprite},
            optional: {offset: RenderBoundsOffset, anchor: ScreenAnchor},
        }).consume(({img, anchor: rawAnchor, offset: rawOffset}) => {
            const anchor = rawAnchor ?? DEFAULT_ANCHOR;
            const offset = rawOffset ?? DEFAULT_OFFSET;
            const x = anchoredStart(anchorFractionX(anchor.anchorPosition), widthPx, img.sizeX * unitWidthPx) + Math.floor(offset.x * unitWidthPx);
            const y = anchoredStart(anchorFractionY(anchor.anchorPosition), heightPx, img.sizeY * unitHeightPx) + Math.floor(offset.y * unitHeightPx);
            this._text.drawText(framebuffer, img, x, y, HUD_DEPTH);
        });
    }
}
