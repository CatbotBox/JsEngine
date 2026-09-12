import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer} from "../consoleScreenBuffer";
import {HudElement} from "../../hudElement";
import {ScreenSize} from "../../screenSize";
import {anchorFractionX, anchorFractionY, ConsoleImageAnchor} from "../consoleImageAnchor";
import {RenderBoundsOffset} from "../../renderBoundsOffset";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {ConsoleSprite} from "./consoleSprite";
import {Console2DRenderSettings} from "./console2DRenderSettings";
import {SpriteRasterizer} from "./spriteRasterizer";

// Shared defaults for HUD entities that omit an anchor or offset. Allocated once
// rather than per row — they are never written.
const DEFAULT_ANCHOR = new ConsoleImageAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();

/**
 * Draws ConsoleSprite + HudElement entities anchored in screen space — the
 * pixel/half-block counterpart of ConsoleHudRenderPassSystem, which does the
 * same for glyph-based ConsoleImages. Runs only while a singleton
 * Console2DRenderSettings exists (its halfBlockCells/quantization apply; depth
 * fade never does — HUD cells sit at -Infinity).
 *
 * Anchoring happens in half-rows, so an odd-height sprite still sits flush
 * against a bottom anchor. Like the text HUD, a HUD cell claims the whole
 * cell: an uncovered half shows the console background, not the world pixels
 * behind it. Runs just before the text HUD so labels win overlaps.
 */
export class ConsoleSpriteHudRenderPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([Console2DRenderSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([ConsoleSprite, HudElement]);

    private _rasterizer = new SpriteRasterizer();

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        // After camera sizing, before ConsoleHudRenderPassSystem (100): text HUD
        // blits tie-break later-wins at equal depth, so labels draw over icons.
        return 99;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery); // always require a camera
        this.requireAnyForUpdate(this._hudObjectQuery); // and at least one HUD sprite
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

        // HUD elements are screen-space, not world-space, so no camera transform applies.
        this._hudObjectQuery.stream({
            read: {sprite: ConsoleSprite},
            optional: {offset: RenderBoundsOffset, anchor: ConsoleImageAnchor},
        }).consume(({sprite, anchor: rawAnchor, offset: rawOffset}) => {
            const image = sprite.image;
            if (image === undefined) return;
            const anchor = rawAnchor ?? DEFAULT_ANCHOR;
            const offset = rawOffset ?? DEFAULT_OFFSET;
            const ax = anchorFractionX(anchor.anchorPosition);
            const ay = anchorFractionY(anchor.anchorPosition);

            // Place top-left so the anchor "point" on the sprite aligns to the same
            // point on the screen. X is in cells; Y anchors in half-rows (two per
            // cell), the vertical resolution sprites actually render at. Offsets
            // keep the text HUD's cell units.
            const sx = Math.floor(ax * (screenW - image.sizeX)) + ((offset?.x ?? 0) | 0);
            const hy = Math.floor(ay * (screenH * 2 - image.sizeY)) + (((offset?.y ?? 0) | 0) * 2);
            // -Infinity depth: above every world sprite and 3D mesh, and immune to
            // depth fade (the fade factor clamps to 1).
            rasterizer.blitSprite(image, sx, hy, Number.NEGATIVE_INFINITY, sprite.tint, sprite.opacity);
        });

        rasterizer.endFrame();
    }
}
