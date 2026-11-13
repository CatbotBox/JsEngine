import {System} from "../../../engine/core";
import {Camera} from "../../../engine/rendering/camera";
import {CellGrid} from "../cellGrid";
import {HudElement} from "../../../engine/rendering/hudElement";
import {LocalToWorld} from "../../../engine/translation";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {CellRenderSystemGroup} from "../cellRenderSystemGroup";
import {Sprite} from "../../../engine/rendering/2d/sprite";
import {TextSpriteCellPassSettings} from "./textSpriteCellPassSettings";
import {SpriteCellRasterizer} from "./spriteCellRasterizer";
import {SpriteBoundsSystem} from "../../../engine/rendering/2d/spriteBoundsSystem";
import {WorldSpaceRenderBounds} from "../../../engine/rendering/worldSpaceRenderBounds";
import {Vec} from "../../../engine/math/types/vec";
import {AABB_STRIDE, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z} from "../../../engine/datatypes/aabb";
import {MAT4_FLOATS_SHIFT, MAT4_TRANSLATION_Z} from "../../../engine/math/mat4Layout";

const CAMERA_DEPTH_EXTENT = 1000;
const HALF_ROWS_PER_CELL = 2;

export class SpriteCellPassSystem extends System {
    private _settingsQuery = this.createEntityQuery([TextSpriteCellPassSettings]);
    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([Sprite, WorldSpaceRenderBounds], [HudElement]);

    private _boundsToken = WorldSpaceRenderBounds.type();
    private _spriteToken = Sprite.type();
    private _localToWorldToken = LocalToWorld.type();

    private _rasterizer = new SpriteCellRasterizer();

    public spritesDrawn = 0;

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._settingsQuery);
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._objectQuery);

        this.world.ensureSystemExists(SpriteBoundsSystem);
    }

    override update(): void {
        this.spritesDrawn = 0;
        super.update();
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;

        const settings = this._settingsQuery.getSingleton({settings: TextSpriteCellPassSettings}).settings;
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

                this.spritesDrawn++;
                rasterizer.blitSprite(
                    image,
                    Math.floor(xMin - camXMin),
                    Math.floor((yMin - camYMin) * HALF_ROWS_PER_CELL),
                    l2w !== undefined ? l2w[(row << MAT4_FLOATS_SHIFT) + MAT4_TRANSLATION_Z] : 0,
                    sprite.tint,
                    sprite.opacity,
                );
            }
        }

        rasterizer.endFrame();
    }
}
