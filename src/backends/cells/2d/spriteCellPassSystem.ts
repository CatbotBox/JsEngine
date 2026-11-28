import {System} from "../../../engine/core";
import type {RenderPassKind} from "../../../engine/rendering/renderPasses";
import {Camera} from "../../../engine/rendering/camera";
import {CellGrid} from "../cellGrid";
import {HudElement} from "../../../engine/rendering/hudElement";
import {LocalToWorld} from "../../../engine/translation";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {RenderCameraOverride, renderCameraComponents} from "../../../engine/rendering/renderCameraOverride";
import {CellRenderSystemGroup} from "../cellRenderSystemGroup";
import {Sprite} from "../../../engine/rendering/2d/sprite";
import {SpriteCellPassSettings} from "./spriteCellPassSettings";
import {SpriteCellRasterizer} from "./spriteCellRasterizer";
import {SpriteBoundsSystem} from "../../../engine/rendering/2d/spriteBoundsSystem";
import {WorldSpaceRenderBounds} from "../../../engine/rendering/worldSpaceRenderBounds";
import {Vec} from "../../../engine/math/types/vec";
import {WorldViewRect, worldViewRectInto} from "../../../engine/rendering/screenUnits";
import {AABB_STRIDE, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z} from "../../../engine/datatypes/aabb";
import {MAT4_FLOATS_SHIFT, MAT4_TRANSLATION_Z} from "../../../engine/math/mat4Layout";

const CAMERA_SPEC = {camera: Camera, screenSize: ScreenSize, localToWorld: LocalToWorld};
const CAMERA_DEPTH_EXTENT = 1000;
const NO_WALKS = 0;
const NOTHING_DRAWN = 0;

export class SpriteCellPassSystem extends System {
    public static readonly renderPass: RenderPassKind = "sprites";

    private _settingsQuery = this.createEntityQuery([SpriteCellPassSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([Sprite, WorldSpaceRenderBounds], [HudElement]);

    private _boundsToken = WorldSpaceRenderBounds.type();
    private _spriteToken = Sprite.type();
    private _localToWorldToken = LocalToWorld.type();

    private _rasterizer = new SpriteCellRasterizer();
    private _view = new WorldViewRect();

    private _spritesDrawn = NOTHING_DRAWN;
    private _statsWalk = NO_WALKS;

    public get spritesDrawn(): number {
        this.dropStaleStats();
        return this._spritesDrawn;
    }

    private dropStaleStats(): void {
        if (this._statsWalk !== this.groupWalkCount()) this._spritesDrawn = NOTHING_DRAWN;
    }

    private groupWalkCount(): number {
        return this.world.tryGetSystem(CellRenderSystemGroup)?.walkCount ?? NO_WALKS;
    }

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._settingsQuery);
        this.requireQueryOrResourceForUpdate(this._cameraQuery, RenderCameraOverride);
        this.requireAnyForUpdate(this._objectQuery);

        this.world.ensureSystemExists(SpriteBoundsSystem);
    }

    onUpdate() {
        this._spritesDrawn = NOTHING_DRAWN;
        this._statsWalk = this.groupWalkCount();
        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: SpriteCellPassSettings}).settings;
        const cameraEntity = renderCameraComponents(this.world, this._cameraQuery, CAMERA_SPEC);
        if (cameraEntity === undefined) return;

        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const width = screenSize.x | 0;
        const height = screenSize.y | 0;
        const view = worldViewRectInto(this._view, Vec.x(position), Vec.y(position), screenSize.x, screenSize.y);
        const camXMin = view.xMin, camXMax = view.xMax;
        const camYMin = view.yMin, camYMax = view.yMax;
        const camZMin = -CAMERA_DEPTH_EXTENT, camZMax = CAMERA_DEPTH_EXTENT;

        const rasterizer = this._rasterizer;
        rasterizer.beginFrame(dualScreenBuffer.screenBuffer, width, height, settings.toRasterizerConfig());

        for (const arch of this._objectQuery.archetypes) {
            const boundsCol = arch.getColumn(this._boundsToken);
            const spriteCol = arch.getColumn(this._spriteToken);
            if (boundsCol === undefined || spriteCol === undefined) continue;
            const wb = boundsCol.f32Data;
            if (wb === undefined) continue;

            const l2w = arch.getColumn(this._localToWorldToken)?.f32Data;

            const n = arch.enabledEntityCount;
            for (let row = 0; row < n; row++) {
                const b = row * AABB_STRIDE;
                const xMin = wb[b + AABB_MIN_X], yMin = wb[b + AABB_MIN_Y];
                if (wb[b + AABB_MAX_X] < camXMin || xMin > camXMax) continue;
                if (wb[b + AABB_MAX_Y] < camYMin || yMin > camYMax) continue;
                if (wb[b + AABB_MAX_Z] < camZMin || wb[b + AABB_MIN_Z] > camZMax) continue;

                const sprite = spriteCol.get(row) as Sprite;
                const image = sprite.image;
                if (image === undefined) continue;

                this._spritesDrawn++;
                rasterizer.blitSprite(
                    image,
                    Math.floor(xMin - camXMin),
                    Math.floor(yMin - camYMin),
                    l2w !== undefined ? l2w[(row << MAT4_FLOATS_SHIFT) + MAT4_TRANSLATION_Z] : 0,
                    sprite.tint,
                    sprite.opacity,
                );
            }
        }

        rasterizer.endFrame();
    }
}
