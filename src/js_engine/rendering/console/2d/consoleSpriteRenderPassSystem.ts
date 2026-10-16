import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer} from "../consoleScreenBuffer";
import {HudElement} from "../../hudElement";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {Sprite} from "../../2d/sprite";
import {Console2DRenderSettings} from "./console2DRenderSettings";
import {SpriteRasterizer} from "./spriteRasterizer";
import {RenderBoundsSpriteApplyModifierSystem} from "./renderBoundsSpriteApplyModifierSystem";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {Vec} from "../../../math/types/vec";

/**
 * Draws every Sprite as packed-RGB half-block cells — the 2D counterpart
 * of Console3DRenderPassSystem, sharing its ScreenBuffer color pipeline (depth
 * compositing, half-block split cells, quantization, depth fade) instead of the
 * legacy ANSI-text blit of Console2DRenderPassSystem. Runs only while a
 * singleton Console2DRenderSettings entity exists; that entity is the
 * configuration.
 */
export class ConsoleSpriteRenderPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([Console2DRenderSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([Sprite, WorldSpaceRenderBounds], [HudElement]);

    private _boundsToken = WorldSpaceRenderBounds.type();
    private _spriteToken = Sprite.type();
    private _localToWorldToken = LocalToWorld.type();

    private _rasterizer = new SpriteRasterizer();

    /** Sprites handed to the rasterizer this frame, after camera culling. */
    public spritesDrawn = 0;

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery); // always require a camera
        this.requireAnyForUpdate(this._objectQuery); // and at least one sprite

        this.world.ensureSystemExists(RenderBoundsSpriteApplyModifierSystem);
    }

    /** The frame stat reads as zero whenever the pass is disabled or has nothing to draw. */
    override update(): void {
        this.spritesDrawn = 0;
        super.update();
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: Console2DRenderSettings}).settings;
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
        });

        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const width = screenSize.x | 0;
        const height = screenSize.y | 0;
        const cx0 = Vec.x(position) - 0.5 * screenSize.x;
        const cy0 = Vec.y(position) - 0.5 * screenSize.y;
        const cx1 = cx0 + screenSize.x;
        const cy1 = cy0 + screenSize.y;

        const camXMin = Math.min(cx0, cx1), camXMax = Math.max(cx0, cx1);
        const camYMin = Math.min(cy0, cy1), camYMax = Math.max(cy0, cy1);
        const camZMin = -1000, camZMax = 1000;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(dualScreenBuffer.screenBuffer, width, height, settings.toRasterizerConfig());

        for (const arch of this._objectQuery.archetypes) {
            const boundsCol = arch.getColumn(this._boundsToken);
            const spriteCol = arch.getColumn(this._spriteToken);
            if (boundsCol === undefined || spriteCol === undefined) continue;
            const wb = boundsCol.f32Data;
            if (wb === undefined) continue;

            const l2w = arch.getColumn(this._localToWorldToken)?.f32Data;

            const n = arch.entityCount;
            for (let row = 0; row < n; row++) {
                // AABB layout: [xMin, yMin, zMin, xMax, yMax, zMax]
                const b = row * 6;
                const xMin = wb[b], yMin = wb[b + 1];
                if (wb[b + 3] < camXMin || xMin > camXMax) continue;
                if (wb[b + 4] < camYMin || yMin > camYMax) continue;
                if (wb[b + 5] < camZMin || wb[b + 2] > camZMax) continue;

                const sprite = spriteCol.get(row) as Sprite;
                const image = sprite.image;
                if (image === undefined) continue;

                this.spritesDrawn++;
                rasterizer.blitSprite(
                    image,
                    Math.floor(xMin - camXMin),
                    // Half-rows: the vertical axis has twice the cell resolution,
                    // so fractional world Y positions land on half-cell boundaries.
                    Math.floor((yMin - camYMin) * 2),
                    l2w !== undefined ? l2w[(row << 4) + 14] : 0,
                    sprite.tint,
                    sprite.opacity,
                );
            }
        }

        rasterizer.endFrame();
    }
}
