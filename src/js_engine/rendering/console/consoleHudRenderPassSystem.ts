import {System} from "../../core";
import {Camera} from "../camera";
import {ConsoleScreenBuffer} from "./consoleScreenBuffer";
import {HudElement} from "../hudElement";
import {ScreenSize} from "../screenSize";
import {anchorFractionX, anchorFractionY, ConsoleImageAnchor} from "./consoleImageAnchor";
import {RenderBoundsOffset} from "../renderBoundsOffset";
import {ConsoleImage} from "./consoleImage";
import {ConsoleRenderPassSystemGroup} from "./consoleRenderPassSystemGroup";

// Shared defaults for HUD entities that omit an anchor or offset. Allocated once
// rather than per row — they are never written.
const DEFAULT_ANCHOR = new ConsoleImageAnchor();
const DEFAULT_OFFSET = new RenderBoundsOffset();

export class ConsoleHudRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize]);
    private _hudObjectQuery = this.createEntityQuery([ConsoleImage, HudElement])

    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 100; // after camera sizing
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery) // always require a camera
        this.requireAnyForUpdate(this._hudObjectQuery) // and at least one HUD element
    }

    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            screenSize: ScreenSize,
        });

        // Prepare current buffer
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const hudEntities = this._hudObjectQuery
            .stream({
                read: {img: ConsoleImage},
                optional: {offset: RenderBoundsOffset, anchor: ConsoleImageAnchor},
            });

        // HUD elements are screen-space, not world-space, so no camera transform applies.
        // consume: the components are passed onward (blit reads img during the
        // call), but the row object itself never escapes.
        hudEntities.consume(({img, anchor: rawAnchor, offset: rawOffset}) => {
            const anchor = rawAnchor ?? DEFAULT_ANCHOR;
            const offset = rawOffset ?? DEFAULT_OFFSET;
            const ax = anchorFractionX(anchor.anchorPosition);
            const ay = anchorFractionY(anchor.anchorPosition);

            // Screen size & image size
            const screenW = cameraEntity.screenSize.x | 0;
            const screenH = cameraEntity.screenSize.y | 0;

            // Place top-left so that the anchor "point" on the image aligns to the same
            // anchor "point" on the screen
            const sx = Math.floor(ax * (screenW - img.sizeX)) + ((offset?.x ?? 0) | 0);
            const sy = Math.floor(ay * (screenH - img.sizeY)) + ((offset?.y ?? 0) | 0);
            // Blit directly in screen space (cur = current ScreenBuffer)
            screenBuffer.blit(img, sx, sy, Number.NEGATIVE_INFINITY);
        });
    }


}
