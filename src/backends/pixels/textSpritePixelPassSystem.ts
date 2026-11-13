import {System} from "../../engine/core";
import {Camera} from "../../engine/rendering/camera";
import {HudElement} from "../../engine/rendering/hudElement";
import {LocalToWorld} from "../../engine/translation";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {TextSprite} from "../../engine/rendering/textSprite";
import {TextSpriteBoundsSystem} from "../../engine/rendering/textSpriteBoundsSystem";
import {WorldSpaceRenderBounds} from "../../engine/rendering/worldSpaceRenderBounds";
import {Vec} from "../../engine/math/types/vec";
import {AABB_STRIDE, AABB_MIN_X, AABB_MIN_Y, AABB_MIN_Z, AABB_MAX_X, AABB_MAX_Y, AABB_MAX_Z} from "../../engine/datatypes/aabb";
import {MAT4_FLOATS_SHIFT, MAT4_TRANSLATION_Z} from "../../engine/math/mat4Layout";
import {PixelFramebuffer} from "./pixelFramebuffer";
import {PixelRenderSystemGroup} from "./pixelRenderSystemGroup";
import {PixelTextRasterizer} from "./pixelTextRasterizer";

const CAMERA_DEPTH_EXTENT = 1000;
const CENTER_FRACTION = 0.5;

export class TextSpritePixelPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([TextSprite, WorldSpaceRenderBounds], [HudElement]);

    private _boundsToken = WorldSpaceRenderBounds.type();
    private _imageToken = TextSprite.type();
    private _localToWorldToken = LocalToWorld.type();

    private _text = new PixelTextRasterizer();

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery);
        this.requireAnyForUpdate(this._objectQuery);

        this.world.ensureSystemExists(TextSpriteBoundsSystem);
    }

    onUpdate() {
        const framebuffer = this.world.resources.tryGet(PixelFramebuffer);
        if (!framebuffer) return;

        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
        });

        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const cx0 = Vec.x(position) - CENTER_FRACTION * screenSize.x;
        const cy0 = Vec.y(position) - CENTER_FRACTION * screenSize.y;
        const cx1 = cx0 + screenSize.x;
        const cy1 = cy0 + screenSize.y;

        const camXMin = Math.min(cx0, cx1), camXMax = Math.max(cx0, cx1);
        const camYMin = Math.min(cy0, cy1), camYMax = Math.max(cy0, cy1);
        const camZMin = -CAMERA_DEPTH_EXTENT, camZMax = CAMERA_DEPTH_EXTENT;
        const unitWidthPx = framebuffer.pixelsPerScreenUnitX, unitHeightPx = framebuffer.pixelsPerScreenUnitY;

        for (const arch of this._objectQuery.archetypes) {
            const boundsCol = arch.getColumn(this._boundsToken);
            const imageCol = arch.getColumn(this._imageToken);
            if (boundsCol === undefined || imageCol === undefined) continue;
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

                this._text.drawText(
                    framebuffer,
                    imageCol.get(row) as TextSprite,
                    Math.floor((xMin - camXMin) * unitWidthPx),
                    Math.floor((yMin - camYMin) * unitHeightPx),
                    l2w !== undefined ? l2w[(row << MAT4_FLOATS_SHIFT) + MAT4_TRANSLATION_Z] : 0,
                );
            }
        }
    }
}
