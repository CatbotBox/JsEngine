import {System} from "../../../core";
import {Camera} from "../../camera";
import {RenderBounds} from "../../renderBounds";
import {ConsoleScreenBuffer} from "../consoleScreenBuffer";
import {HudElement} from "../../hudElement";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleImage} from "../consoleImage";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {RenderBounds2DComputeSystem} from "./renderBounds2DComputeSystem";
import {Console2DRenderBoundsQueryBuilderSystem} from "./console2DRenderBoundsQueryBuilderSystem";

export class Console2DRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([ConsoleImage, RenderBounds], [HudElement])// private _dualScreenBuffer: [ScreenBuffer, ScreenBuffer] = [new ScreenBuffer(), new ScreenBuffer()];


    override systemGroup() {
        return ConsoleRenderPassSystemGroup;
    }

    override priority(): number {
        return 0;
    }

    protected onCreate() {
        this.requireAllForUpdate(this._cameraQuery) // always require a camera
        this.requireAnyForUpdate(this._objectQuery) // and require at least one renderer object

        this.world.ensureSystemExists(RenderBounds2DComputeSystem)
        // this.world.ensureSystemExists(Console2DRenderBoundsQueryBuilderSystem);
    }

    onUpdate() {
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
        });
        const cameraBounds = new RenderBounds();
        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const x0 = position[0] - 0.5 * screenSize.x;
        const y0 = position[1] - 0.5 * screenSize.y;
        const x1 = x0 + screenSize.x;
        const y1 = y0 + screenSize.y;

        cameraBounds.xMin = Math.min(x0, x1);
        cameraBounds.xMax = Math.max(x0, x1);
        cameraBounds.yMin = Math.min(y0, y1);
        cameraBounds.yMax = Math.max(y0, y1);
        cameraBounds.zMin = -1000;
        cameraBounds.zMax = 1000;


        // Prepare current buffer
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const octTree = this.world.getOrCreateSystem(Console2DRenderBoundsQueryBuilderSystem).octTree;
        const matches = octTree.query(cameraBounds);
        matches.forEach(({bounds, payload}) => {
            // World → screen transform (top-left anchoring)
            const screenX = Math.floor(bounds.xMin - cameraBounds.xMin);
            const screenY = Math.floor(bounds.yMin - cameraBounds.yMin);

            // The image is already sized to its visible width via ConsoleImage.size (ANSI stripped)
            // The blitter will clip to the current screen automatically.
            screenBuffer.blit(payload.consoleImage, screenX, screenY, payload.zHeight);
        })
    }


    override onEnable(): void {
        console.info("Enabled 2D render pass")
    }

    override onDisable(): void {
        console.info("Disabled 2D render pass")
    }
}
