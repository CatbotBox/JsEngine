import {System} from "../../engine/core";
import type {SystemCtor, World} from "../../engine/core";

// A gated root system on purpose: it counts only ticks in which gameplay ran, which is what step and play report.
export class GameplayTickCounterSystem extends System {
    public ticks = 0;

    public onUpdate(): void {
        this.ticks++;
    }
}

export class GameplaySystemGate {
    private readonly enabledBeforeSuspend = new Map<System, boolean>();
    private readonly gated: readonly SystemCtor<System>[];

    public constructor(private readonly world: World, gameplaySystems: readonly SystemCtor<System>[]) {
        this.gated = [GameplayTickCounterSystem, ...gameplaySystems];
    }

    public gameplaySystems(): System[] {
        const live: System[] = [];
        for (const ctor of this.gated) {
            const system = this.world.tryGetSystem(ctor);
            if (system !== undefined && !live.includes(system)) live.push(system);
        }
        return live;
    }

    public suspend(): void {
        for (const system of this.gameplaySystems()) {
            if (!this.enabledBeforeSuspend.has(system)) this.enabledBeforeSuspend.set(system, system.enabled);
            system.enabled = false;
        }
    }

    public resume(): void {
        const live = new Set(this.gameplaySystems());
        for (const [system, enabled] of this.enabledBeforeSuspend) {
            if (live.has(system)) system.enabled = enabled;
        }
        this.enabledBeforeSuspend.clear();
    }
}
