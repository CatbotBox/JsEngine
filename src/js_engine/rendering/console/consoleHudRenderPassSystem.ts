import {System} from "../../core";
import {Camera} from "../camera";
import {ConsoleScreenBuffer} from "./consoleScreenBuffer";
import {HudElement} from "../hudElement";
import {ScreenSize} from "../screenSize";
import {ConsoleImageAnchor} from "./consoleImageAnchor";
import {RenderBoundsOffset} from "../renderBoundsOffset";
import {ConsoleImage} from "./consoleImage";
import {ConsoleRenderPassSystemGroup} from "./consoleRenderPassSystemGroup";

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
        this.requireAnyForUpdate(this._hudObjectQuery) // or one hud object
    }

    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            screenSize: ScreenSize,
        });


        // Prepare current buffer
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        // Only consider on-screen objects
        const hudEntities = this._hudObjectQuery
            .stream({offset: RenderBoundsOffset, img: ConsoleImage, anchor: ConsoleImageAnchor})
            .collect();

        // HUD elements (screen-space, not world-space)
        // HUD elements (screen-space, not world-space)
        for (const {img, anchor = new ConsoleImageAnchor(), offset = new RenderBoundsOffset()} of hudEntities) {
            // Parse anchor into fractions (0 = left/top, 0.5 = center/middle, 1 = right/bottom)
            const [v, h] = (anchor.anchorPosition).split('-') as
                ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];

            const ax = h === 'left' ? 0 : h === 'center' ? 0.5 : 1;   // horizontal anchor
            const ay = v === 'top' ? 0 : v === 'middle' ? 0.5 : 1;   // vertical anchor

            // Screen size & image size
            const screenW = cameraEntity.screenSize.x | 0;
            const screenH = cameraEntity.screenSize.y | 0;

            // Place top-left so that the anchor "point" on the image aligns to the same
            // anchor "point" on the screen
            const sx = Math.floor(ax * (screenW - img.sizeX)) + ((offset?.x ?? 0) | 0);
            const sy = Math.floor(ay * (screenH - img.sizeY)) + ((offset?.y ?? 0) | 0);


            // console.log("HUD", anchor.anchorPosition, "->", sx, sy, " screen:", screenW, screenH, " img:", imgSize.x, imgSize.y)
            // Blit directly in screen space (cur = current ScreenBuffer)
            screenBuffer.blit(img, sx, sy, Number.POSITIVE_INFINITY);
        }
    }


    override onEnable(): void {
        console.info("Enabled Hud render pass")
    }

    override onDisable(): void {
        console.info("Disabled Hud render pass")
    }
}
