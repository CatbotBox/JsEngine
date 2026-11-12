import {System} from "../../../engine/core";
import {Camera} from "../../../engine/rendering/camera";
import {CellGrid} from "../cellGrid";
import {HudElement} from "../../../engine/rendering/hudElement";
import {LocalToWorld} from "../../../engine/translation";
import {ScreenSize} from "../../../engine/rendering/screenSize";
import {TextSprite} from "../../../engine/rendering/textSprite";
import {CellRenderSystemGroup} from "../cellRenderSystemGroup";
import {TextSpriteBoundsSystem} from "../../../engine/rendering/textSpriteBoundsSystem";
import {WorldSpaceRenderBounds} from "../../../engine/rendering/worldSpaceRenderBounds";
import {Vec} from "../../../engine/math/types/vec";
import {AABB_STRIDE} from "../../../engine/datatypes/aabb";

const CAMERA_DEPTH_EXTENT = 1000;
const TRANSLATION_Z = 14;

export class TextSpriteCellPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([TextSprite, WorldSpaceRenderBounds], [HudElement])

    private _boundsToken = WorldSpaceRenderBounds.type();
    private _imageToken = TextSprite.type();
    private _localToWorldToken = LocalToWorld.type();

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery)
        this.requireAnyForUpdate(this._objectQuery)

        this.world.ensureSystemExists(TextSpriteBoundsSystem)
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.tryGet(CellGrid);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
        });

        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const cx0 = Vec.x(position) - 0.5 * screenSize.x;
        const cy0 = Vec.y(position) - 0.5 * screenSize.y;
        const cx1 = cx0 + screenSize.x;
        const cy1 = cy0 + screenSize.y;

        const camXMin = Math.min(cx0, cx1), camXMax = Math.max(cx0, cx1);
        const camYMin = Math.min(cy0, cy1), camYMax = Math.max(cy0, cy1);
        const camZMin = -CAMERA_DEPTH_EXTENT, camZMax = CAMERA_DEPTH_EXTENT;

        for (const arch of this._objectQuery.archetypes) {
            const boundsCol = arch.getColumn(this._boundsToken);
            const imageCol = arch.getColumn(this._imageToken);
            if (boundsCol === undefined || imageCol === undefined) continue;
            const wb = boundsCol.f32Data;
            if (wb === undefined) continue;

            const l2w = arch.getColumn(this._localToWorldToken)?.f32Data;

            const n = arch.entityCount;
            for (let row = 0; row < n; row++) {
                const b = row * AABB_STRIDE;
                const xMin = wb[b], yMin = wb[b + 1];
                if (wb[b + 3] < camXMin || xMin > camXMax) continue;
                if (wb[b + 4] < camYMin || yMin > camYMax) continue;
                if (wb[b + 5] < camZMin || wb[b + 2] > camZMax) continue;

                screenBuffer.blit(
                    imageCol.get(row) as TextSprite,
                    Math.floor(xMin - camXMin),
                    Math.floor(yMin - camYMin),
                    l2w !== undefined ? l2w[(row << 4) + TRANSLATION_Z] : 0,
                );
            }
        }
    }
}
