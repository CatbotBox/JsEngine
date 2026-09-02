import {System} from "../../../core";
import {Camera} from "../../camera";
import {ConsoleScreenBuffer} from "../consoleScreenBuffer";
import {HudElement} from "../../hudElement";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleImage} from "../consoleImage";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {RenderBounds2DApplyModifierSystem} from "./renderBounds2DApplyModifierSystem";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {Vec} from "../../../math/types/vec";

export class Console2DRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([ConsoleImage, WorldSpaceRenderBounds], [HudElement])

    private _boundsToken = WorldSpaceRenderBounds.type();
    private _imageToken = ConsoleImage.type();
    private _localToWorldToken = LocalToWorld.type();

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery) // always require a camera
        this.requireAnyForUpdate(this._objectQuery) // and require at least one renderer object

        this.world.ensureSystemExists(RenderBounds2DApplyModifierSystem)
    }

    onUpdate() {
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
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
        const camZMin = -1000, camZMax = 1000;

        for (const arch of this._objectQuery.archetypes) {
            const boundsCol = arch.getColumn(this._boundsToken);
            const imageCol = arch.getColumn(this._imageToken);
            if (boundsCol === undefined || imageCol === undefined) continue;
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

                screenBuffer.blit(
                    imageCol.get(row) as ConsoleImage,
                    Math.floor(xMin - camXMin),
                    Math.floor(yMin - camYMin),
                    l2w !== undefined ? l2w[(row << 4) + 14] : 0,
                );
            }
        }
    }
}
