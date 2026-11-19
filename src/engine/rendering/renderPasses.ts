import {Resource} from "../core/resource";
import type {System, SystemCtor} from "../core/system";
import type {World} from "../core/world";

export type RenderPassKind = "meshes" | "sprites" | "hudSprites" | "hudText" | "worldText";

export type RenderPassCtor = SystemCtor<System> & {readonly renderPass: RenderPassKind};

const NO_SYSTEMS: readonly System[] = [];

function isInItsWorld(system: System): boolean {
    return system.world.tryGetSystem(system.constructor as SystemCtor<System>) === system;
}

export class RenderPasses extends Resource {
    private readonly _systemsByKind = new Map<RenderPassKind, System[]>();

    public register(kind: RenderPassKind, system: System): void {
        const systems = this._systemsByKind.get(kind);
        if (systems === undefined) this._systemsByKind.set(kind, [system]);
        else if (!systems.includes(system)) systems.push(system);
    }

    public isEnabled(kind: RenderPassKind): boolean {
        return this.liveSystemsOf(kind).some(system => system.enabled);
    }

    public setEnabled(kind: RenderPassKind, enabled: boolean): void {
        for (const system of this.liveSystemsOf(kind)) system.enabled = enabled;
    }

    public toggle(kind: RenderPassKind): void {
        this.setEnabled(kind, !this.isEnabled(kind));
    }

    private liveSystemsOf(kind: RenderPassKind): readonly System[] {
        const systems = this._systemsByKind.get(kind);
        return systems === undefined ? NO_SYSTEMS : systems.filter(isInItsWorld);
    }
}

export function createRenderPasses(world: World, passes: readonly RenderPassCtor[]): void {
    const registered = world.resources.getOrCreate(RenderPasses);
    for (const pass of passes) registered.register(pass.renderPass, world.getOrCreateSystem(pass));
}
