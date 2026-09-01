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
import {EntityArchetype} from "../../../core/entityArchetype";
import {AABB} from "../../../datatypes/AABB";
import {Vec} from "../../../math/types/vec";
import {LinearIndex} from "../../../datatypes/spatial";
import {QueryHit} from "../../../datatypes/spatial";

interface SpritePayload {
    consoleImage: ConsoleImage;
    zHeight: number;
}

export class Console2DRenderPassSystem extends System {

    private _cameraQuery = this.createEntityQuery([Camera, ScreenSize, LocalToWorld]);
    private _objectQuery = this.createEntityQuery([ConsoleImage, WorldSpaceRenderBounds], [HudElement])

    private _index = new LinearIndex<SpritePayload>();

    /** Archetypes currently represented in the index, mapped to their batch id. */
    private _batchIds = new Map<EntityArchetype, number>();
    private _nextBatchId = 0;

    /** Reused across frames so a query costs no allocation. */
    private _hits: QueryHit<SpritePayload>[] = [];
    private _cameraBounds = new RenderBounds();

    // Scratch for one archetype's worth of items, refilled per batch. Safe to
    // share: replaceBatch copies the bounds out and only retains the payload
    // *references*, so the arrays themselves can be reused immediately.
    private _boundsScratch: AABB[] = [];
    private _payloadScratch: SpritePayload[] = [];

    /**
     * Payload records pooled PER ARCHETYPE, not globally. The index holds these
     * objects until the batch is replaced, so a pool shared across archetypes
     * would have archetype B's entity 0 overwrite archetype A's entity 0 — and A
     * would then render B's image.
     */
    private _payloadPools = new Map<number, SpritePayload[]>();

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
        const cameraEntity = this._cameraQuery.getSingleton({
            camera: Camera,
            screenSize: ScreenSize,
            localToWorld: LocalToWorld,
        });

        const cameraBounds = this._cameraBounds;
        const position = cameraEntity.localToWorld.position;
        const screenSize = cameraEntity.screenSize;
        const x0 = Vec.x(position) - 0.5 * screenSize.x;
        const y0 = Vec.y(position) - 0.5 * screenSize.y;
        const x1 = x0 + screenSize.x;
        const y1 = y0 + screenSize.y;

        cameraBounds.xMin = Math.min(x0, x1);
        cameraBounds.xMax = Math.max(x0, x1);
        cameraBounds.yMin = Math.min(y0, y1);
        cameraBounds.yMax = Math.max(y0, y1);
        cameraBounds.zMin = -1000;
        cameraBounds.zMax = 1000;

        this.updateIndex();

        const dualScreenBuffer = this.world.resources.tryGet(ConsoleScreenBuffer);
        if (!dualScreenBuffer) return;
        const screenBuffer = dualScreenBuffer.screenBuffer;

        const hits = this._hits;
        const found = this._index.query(cameraBounds.bounds, hits);

        // Indexed loop over the reused buffer: forEach with a destructuring
        // callback ran a closure per item per frame.
        const camX = cameraBounds.xMin, camY = cameraBounds.yMin;
        for (let i = 0; i < found; i++) {
            const hit = hits[i];
            // World -> screen transform (top-left anchoring). The image is already
            // sized to its visible width via ConsoleImage.size (ANSI stripped), and
            // blit() clips to the current screen.
            screenBuffer.blit(
                hit.payload.consoleImage,
                Math.floor(hit.xMin - camX),
                Math.floor(hit.yMin - camY),
                hit.payload.zHeight,
            );
        }
    }

    override onEnable(): void {
        console.info("Enabled 2D render pass")
    }

    override onDisable(): void {
        console.info("Disabled 2D render pass")
    }

    private updateIndex(): void {
        const archetypes = this._objectQuery.archetypes;
        const lastUpdatedTimeRequirement = this.lastUpdateTime;

        // Archetypes that were in the index last frame; whatever is left in here
        // after the loop has disappeared and must be removed.
        const stale = new Set(this._batchIds.keys());

        for (const arch of archetypes) {
            stale.delete(arch);

            let skipped = true;
            // don't skip if structural change detected
            if (arch.lastStructuralChangeTime >= lastUpdatedTimeRequirement) {
                skipped = false;
            }

            const renderBoundsCol = arch.getColumn(WorldSpaceRenderBounds.type());
            const consoleImageCol = arch.getColumn(ConsoleImage.type());
            const localToWorldCol = arch.getColumn(LocalToWorld.type());
            if (renderBoundsCol === undefined) throw new Error("RenderBounds is not found (this shouldn't happen)");
            if (consoleImageCol === undefined) throw new Error("ConsoleImage is not found (this shouldn't happen)");

            // don't skip if the entities' spatial bounds changed (position/size) -- the index only
            // needs to be touched for spatial reasons; image *content* (color/glyphs) changes don't move
            // anything, and blit() already reads the current pixels off the same live ConsoleImage
            // reference every frame regardless of whether it's reinserted here.
            if (skipped && renderBoundsCol.lastUpdatedTime >= lastUpdatedTimeRequirement) {
                skipped = false;
            }

            if (skipped) continue;

            const batchId = this.batchIdFor(arch);
            const bounds = this._boundsScratch;
            const payloads = this._payloadScratch;
            let pool = this._payloadPools.get(batchId);
            if (pool === undefined) {
                pool = [];
                this._payloadPools.set(batchId, pool);
            }
            bounds.length = 0;
            payloads.length = 0;

            const entityCount = arch.entityCount;
            // Raw SoA column for the matrix: the old `.position` getter minted a
            // subarray view per entity per frame just to read one float (tz).
            const l2wF32 = localToWorldCol?.f32Data;
            for (let id = 0; id < entityCount; id++) {
                // Pooled payload records: this loop runs over every entity of a
                // changed archetype, every frame it changes.
                let payload = pool[id];
                if (payload === undefined) {
                    payload = {consoleImage: undefined as unknown as ConsoleImage, zHeight: 0};
                    pool[id] = payload;
                }
                payload.consoleImage = consoleImageCol.get(id);
                payload.zHeight = l2wF32 !== undefined ? l2wF32[(id << 4) + 14] : 0;

                bounds.push((renderBoundsCol.get(id) as WorldSpaceRenderBounds).bounds);
                payloads.push(payload);
            }

            this._index.replaceBatch(batchId, bounds, payloads);
        }

        for (const arch of stale) {
            const id = this._batchIds.get(arch);
            if (id !== undefined) {
                this._index.removeBatch(id);
                this._payloadPools.delete(id);   // archetype is gone; drop its pool
            }
            this._batchIds.delete(arch);
        }
    }

    /** Stable integer id per archetype — the index keys batches by number. */
    private batchIdFor(arch: EntityArchetype): number {
        let id = this._batchIds.get(arch);
        if (id === undefined) {
            id = this._nextBatchId++;
            this._batchIds.set(arch, id);
        }
        return id;
    }
}
