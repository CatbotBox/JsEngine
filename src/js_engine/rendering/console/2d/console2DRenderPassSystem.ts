import {System} from "../../../core";
import {Camera} from "../../camera";
import {RenderBounds} from "../../renderBounds";
import {ConsoleScreenBuffer} from "../consoleScreenBuffer";
import {HudElement} from "../../hudElement";
import {LocalToWorld} from "../../../translation";
import {ScreenSize} from "../../screenSize";
import {ConsoleImage} from "../consoleImage";
import {ConsoleRenderPassSystemGroup} from "../consoleRenderPassSystemGroup";
import {RenderBounds2DApplyModifierSystem} from "./renderBounds2DApplyModifierSystem";
import {WorldSpaceRenderBounds} from "../../worldSpaceRenderBounds";
import {TrackedOctree} from "../../../datatypes/octTree/trackedOctTree";
import {EntityArchetype} from "../../../core/entityArchetype";
import {AABB} from "../../../datatypes/AABB";

export class Console2DRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([ConsoleImage, WorldSpaceRenderBounds], [HudElement])// private _dualScreenBuffer: [ScreenBuffer, ScreenBuffer] = [new ScreenBuffer(), new ScreenBuffer()];
    private _octTree = new TrackedOctree<{
        consoleImage: ConsoleImage;
        zHeight: number;
    }, EntityArchetype>();
    private tracked: Set<EntityArchetype> = new Set();

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

        this.updateOctTree();

        // Prepare current buffer
        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const octTree = this._octTree;
        const matches = octTree.query(cameraBounds);

        matches.forEach(({bounds, payload}) => {
            // World → screen transform (top-left anchoring)
            const screenX = Math.floor(bounds.xMin - cameraBounds.xMin);
            const screenY = Math.floor(bounds.yMin - cameraBounds.yMin);

            // The image is already sized to its visible width via ConsoleImage.size (ANSI stripped)
            // The blitter will clip to the current screen automatically.
            screenBuffer.blit(payload.consoleImage, screenX, screenY, payload.zHeight);
        });
    }


    override onEnable(): void {
        console.info("Enabled 2D render pass")
    }

    override onDisable(): void {
        console.info("Disabled 2D render pass")
    }

    private updateOctTree(): void {
        const tempSet = new Set<EntityArchetype>(this.tracked);
        const archetypes = this._objectQuery.archetypes;
        const lastUpdatedTimeRequirement = this.lastUpdateTime

        const pooledArray: {
            bounds: AABB;
            payload: {
                zHeight: number;
                consoleImage: ConsoleImage;
            }
        }[] = []

        for (const arch of archetypes) {
            tempSet.delete(arch)
            let skipped = true;

            // dont skip if structural change detected
            if (arch.lastStructuralChangeTime >= lastUpdatedTimeRequirement) {
                skipped = false
            }

            const renderBoundsCol = arch.getColumn(WorldSpaceRenderBounds.type())!;
            const consoleImageCol = arch.getColumn(ConsoleImage.type())!;
            const localToWorldCol = arch.getColumn(LocalToWorld.type());
            if (renderBoundsCol === undefined) throw new Error("RenderBounds is not found (this shouldn't happen)") ;
            if (consoleImageCol === undefined) throw new Error("ConsoleImage is not found (this shouldn't happen)") ;

            // don't skip if component store has a change
            if (skipped && consoleImageCol.lastUpdatedTime >= lastUpdatedTimeRequirement) {
                skipped = false
            }

            if (skipped) continue;
            for (let id = 0; id < arch.entityCount; id++) {
                const zHeight = localToWorldCol
                    ? (localToWorldCol.get(id) as LocalToWorld).position[2]
                    : 0;
                if (this.tracked.has(arch)) this.tracked.add(arch);
                pooledArray.push({
                        payload: {
                            consoleImage: consoleImageCol.get(id),
                            zHeight,
                        }, bounds: renderBoundsCol.get(id)
                    }
                );
            }
            this._octTree.insertBatch(arch, pooledArray);
            pooledArray.length = 0;
        }
        for (const batchId of Array.from(tempSet)) {
            this.tracked.has(batchId);
            this._octTree.removeBatch(batchId);
        }

    }
}
