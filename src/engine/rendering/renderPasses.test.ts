import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core/world";
import {System} from "../core/system";
import type {RenderPassKind} from "./renderPasses";
import {createRenderPasses, RenderPasses} from "./renderPasses";

class SpritePass extends System {
    public static readonly renderPass: RenderPassKind = "sprites";

    public onUpdate(): void {
    }
}

class SecondSpritePass extends System {
    public static readonly renderPass: RenderPassKind = "sprites";

    public onUpdate(): void {
    }
}

class HudTextPass extends System {
    public static readonly renderPass: RenderPassKind = "hudText";

    public onUpdate(): void {
    }
}

const DISABLED = false;
const ENABLED = true;

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

function installed(world: World): RenderPasses {
    createRenderPasses(world, [SpritePass, SecondSpritePass, HudTextPass]);
    return world.resources.get(RenderPasses);
}

describe("createRenderPasses", () => {
    test("creates the passes in the order given", () => {
        const world = newWorld();
        createRenderPasses(world, [HudTextPass, SecondSpritePass, SpritePass]);
        const order = world.rootSystemGroup!.systems.filter(system => system instanceof SpritePass || system instanceof SecondSpritePass || system instanceof HudTextPass);
        expect(order.map(system => system.constructor)).toEqual([HudTextPass, SecondSpritePass, SpritePass]);
    });

    test("registers a pass once when it is installed again", () => {
        const world = newWorld();
        createRenderPasses(world, [SpritePass]);
        createRenderPasses(world, [SpritePass]);
        const passes = world.resources.get(RenderPasses);
        passes.toggle("sprites");
        expect(world.tryGetSystem(SpritePass)!.enabled).toBe(false);
    });
});

describe("RenderPasses", () => {
    test("toggle flips every system of its kind and leaves other kinds alone", () => {
        const world = newWorld();
        const passes = installed(world);
        passes.toggle("sprites");
        expect(world.tryGetSystem(SpritePass)!.enabled).toBe(false);
        expect(world.tryGetSystem(SecondSpritePass)!.enabled).toBe(false);
        expect(world.tryGetSystem(HudTextPass)!.enabled).toBe(true);
        expect(passes.isEnabled("sprites")).toBe(false);
        passes.toggle("sprites");
        expect(world.tryGetSystem(SpritePass)!.enabled).toBe(true);
        expect(passes.isEnabled("sprites")).toBe(true);
    });

    test("setEnabled sets the kind's systems, and a kind is enabled while any of its systems is", () => {
        const world = newWorld();
        const passes = installed(world);
        passes.setEnabled("hudText", DISABLED);
        expect(world.tryGetSystem(HudTextPass)!.enabled).toBe(false);
        expect(passes.isEnabled("hudText")).toBe(false);
        world.tryGetSystem(SecondSpritePass)!.enabled = false;
        expect(passes.isEnabled("sprites")).toBe(true);
        passes.toggle("sprites");
        expect(world.tryGetSystem(SpritePass)!.enabled).toBe(false);
        expect(world.tryGetSystem(SecondSpritePass)!.enabled).toBe(false);
        passes.setEnabled("sprites", ENABLED);
        expect(world.tryGetSystem(SecondSpritePass)!.enabled).toBe(true);
    });

    test("a kind the backend lacks has no systems: it reads disabled and toggling it does nothing", () => {
        const world = newWorld();
        const passes = installed(world);
        expect(passes.isEnabled("meshes")).toBe(false);
        passes.toggle("meshes");
        passes.setEnabled("worldText", ENABLED);
        expect(passes.isEnabled("meshes")).toBe(false);
        expect(passes.isEnabled("worldText")).toBe(false);
        expect([SpritePass, SecondSpritePass, HudTextPass].every(pass => world.tryGetSystem(pass)!.enabled)).toBe(true);
    });

    test("a removed pass no longer counts and is not toggled", () => {
        const world = newWorld();
        const passes = installed(world);
        const removed = world.tryGetSystem(HudTextPass)!;
        world.removeSystem(HudTextPass);
        expect(passes.isEnabled("hudText")).toBe(false);
        passes.toggle("hudText");
        expect(removed.enabled).toBe(true);
        expect(world.tryGetSystem(HudTextPass)).toBeUndefined();
    });
});
