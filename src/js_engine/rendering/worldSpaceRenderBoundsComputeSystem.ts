import {System} from "../core";
import {LocalToWorld} from "../translation";
import {WorldSpaceRenderBounds} from "./worldSpaceRenderBounds";
import {RenderBounds} from "./renderBounds";
import {RenderingSystemGroup} from "./renderingSystemGroup";
import {LocalToWorldSystem} from "../translation/LocalToWorldSystem";
import {RenderBoundsOffset} from "./renderBoundsOffset";

export class WorldSpaceRenderBoundsComputeSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld, WorldSpaceRenderBounds, RenderBounds]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return -10;
    }

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        this.world.ensureSystemExists(LocalToWorldSystem);
    }

    onUpdate() {
        this._query.stream({
            bounds: RenderBounds,
            worldBounds: WorldSpaceRenderBounds,
            offset: RenderBoundsOffset,
            localToWorld: LocalToWorld,
        }, {
            filterLastUpdated: this.lastUpdateTime,
            filterBlackList: [RenderBounds]
        }).forEach(({bounds, localToWorld, worldBounds, offset}) => {
            const position = localToWorld.position;
            // base position after offset
            const px = position[0] + (offset?.x || 0);
            const py = position[1] + (offset?.y || 0);
            const pz = position[2] + (offset?.z || 0);
            // const px = position.x + (offset?.x || 0);
            // const py = position.y + (offset?.y || 0);

            worldBounds.xMin = px + bounds.xMin;
            worldBounds.xMax = px + bounds.xMax;
            worldBounds.yMin = py + bounds.yMin;
            worldBounds.yMax = py + bounds.yMax;
            worldBounds.zMin = pz + bounds.zMin;
            worldBounds.zMax = pz + bounds.zMax;
        })
    }

}