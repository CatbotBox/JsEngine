import {EntityCommandBufferSystem, System} from "../../engine/core";
import type {World} from "../../engine/core";
import {GcSystem} from "../../engine/core/gcSystem";
import {InputSystem} from "../../engine/input/inputSystem";
import {TranslationSystemGroup} from "../../engine/translation/translationSystemGroup";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";

type EngineRootSystemCtor = abstract new () => System;

const ENGINE_ROOT_SYSTEMS: readonly EngineRootSystemCtor[] = [
    TranslationSystemGroup,
    RenderingSystemGroup,
    EntityCommandBufferSystem,
    GcSystem,
    InputSystem,
];

export class GameplayTickCounterSystem extends System {
    public ticks = 0;

    public onUpdate(): void {
        this.ticks++;
    }
}

export function isGameplaySystem(system: System): boolean {
    return !ENGINE_ROOT_SYSTEMS.some(ctor => system instanceof ctor);
}

export class GameplaySystemGate {
    private readonly enabledBeforeSuspend = new Map<System, boolean>();

    public constructor(private readonly world: World) {
    }

    public gameplaySystems(): System[] {
        return (this.world.rootSystemGroup?.systems ?? []).filter(isGameplaySystem);
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
