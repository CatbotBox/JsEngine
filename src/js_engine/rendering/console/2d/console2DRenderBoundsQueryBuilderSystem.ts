import {System} from "../../../core";
import {RenderBounds} from "../../renderBounds";
import {TrackedOctree} from "../../../datatypes/octTree/trackedOctTree";
import {RenderingSystemGroup} from "../../renderingSystemGroup";
import {ConsoleImage, ConsoleRenderPassSystemGroup} from "../index";
import {EntityArchetype} from "../../../core/entityArchetype";
import {AABB} from "../../../datatypes/AABB";
import {HudElement} from "../../hudElement";
import {LocalToWorld} from "../../../translation";

export class Console2DRenderBoundsQueryBuilderSystem extends System {

    private _query = this.createEntityQuery([ConsoleImage, RenderBounds], [HudElement]);
    public octTree = new TrackedOctree<{
        consoleImage: ConsoleImage;
        zHeight: number;
    }>();
    private tracked: Set<EntityArchetype> = new Set();


    override systemGroup() {
        return RenderingSystemGroup;
    }

    priority(): number {
        return this.world.getOrCreateSystem(ConsoleRenderPassSystemGroup).priority() - 1;
    }

    onUpdate(): void {
        const tempSet = new Set<EntityArchetype>(this.tracked);
        const archetypes = this._query.archetypes;
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


            const renderBoundsCol = arch.getColumn(RenderBounds.type())!;
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
            this.octTree.insertBatch(arch, pooledArray);
            pooledArray.length = 0;
        }
        for (const batchId of Array.from(tempSet)) {
            this.tracked.has(batchId);
            this.octTree.removeBatch(batchId);
        }
    }
}