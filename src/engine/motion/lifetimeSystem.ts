import {EntityCommandBufferSystem} from "../core/entityCommandBufferSystem";
import {System} from "../core/system";
import {Lifetime} from "./lifetime";

export const LIFETIME_PRIORITY = -20;

export class LifetimeSystem extends System {
    private _lifetimes = this.createEntityQuery([Lifetime]);

    override priority(): number {
        return LIFETIME_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._lifetimes);
    }

    protected stepMs(): number {
        return this.world.time.deltaTimeMs;
    }

    onUpdate(): void {
        const stepMs = this.stepMs();
        const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        this._lifetimes.stream({write: {lifetime: Lifetime}}, {includeEntity: true}).consume(({entity, lifetime}) => {
            lifetime.remainingMs -= stepMs;
            if (lifetime.remainingMs <= 0) buffer.destroyEntity(entity);
        });
    }
}
