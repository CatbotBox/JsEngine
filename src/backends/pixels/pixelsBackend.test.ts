import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {System} from "../../engine/core/system";
import {activeRenderBackend, CellsRenderBackend, GpuRenderBackend, PixelsRenderBackend} from "../../engine/rendering/renderBackend";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {MemoryPixelPresenter} from "./memoryPixelPresenter";
import {PixelPresenterResource} from "./pixelPresenterResource";
import {PixelRenderSystemGroup} from "./pixelRenderSystemGroup";
import {installPixelsBackend} from "./pixelsBackend";
import {PIXELS_HUD_TEXT_PASSES} from "./pixelsHudTextPasses";
import {PIXELS_WORLD_TEXT_PASSES} from "./pixelsWorldTextPasses";
import {PIXELS_HUD_SPRITE_PASSES} from "./2d/pixelsHudSpritePasses";
import {PIXELS_SPRITE_PASSES} from "./2d/pixelsSpritePasses";
import {PIXELS_MESH_PASSES} from "./3d/pixelsMeshPasses";
import {PIXELS_2D_AND_HUD_PASSES, PIXELS_PASS_LISTS, PIXELS_STANDARD_PASSES} from "./pixelsStandardPasses";

const SIZE = {widthPx: 64, heightPx: 48};
const NO_PASSES: readonly RenderPassCtor[] = [];

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

function passOrder(world: World, passes: readonly RenderPassCtor[]): Function[] {
    const isListed = (system: System) => passes.some(pass => system instanceof pass);
    return world.tryGetSystem(PixelRenderSystemGroup)!.systems.filter(isListed).map(system => system.constructor);
}

describe("installPixelsBackend", () => {
    test("the standard passes are the pass lists in order, and the 2D and HUD passes all but the mesh list", () => {
        expect(PIXELS_PASS_LISTS.flat()).toEqual([...PIXELS_STANDARD_PASSES]);
        expect(PIXELS_PASS_LISTS.filter(list => list !== PIXELS_MESH_PASSES).flat()).toEqual([...PIXELS_2D_AND_HUD_PASSES]);
    });

    test("inserts the presenter and only the pixels marker", () => {
        const world = newWorld();
        const presenter = new MemoryPixelPresenter(SIZE);
        installPixelsBackend(world, presenter, NO_PASSES);
        expect(PixelPresenterResource.presenterOf(world)).toBe(presenter);
        expect(world.resources.tryGet(PixelsRenderBackend)).toBeDefined();
        expect(world.resources.tryGet(CellsRenderBackend)).toBeUndefined();
        expect(world.resources.tryGet(GpuRenderBackend)).toBeUndefined();
        expect(activeRenderBackend(world)).toBe("pixels");
    });

    test("creates the passes in the order given, which decides equal priorities", () => {
        const hud = [...PIXELS_HUD_SPRITE_PASSES, ...PIXELS_HUD_TEXT_PASSES];
        const spritesFirst = [...PIXELS_SPRITE_PASSES, ...PIXELS_WORLD_TEXT_PASSES, ...PIXELS_MESH_PASSES];
        const meshesFirst = [...PIXELS_MESH_PASSES, ...PIXELS_WORLD_TEXT_PASSES, ...PIXELS_SPRITE_PASSES];
        for (const passes of [spritesFirst, meshesFirst]) {
            const world = newWorld();
            installPixelsBackend(world, new MemoryPixelPresenter(SIZE), [...hud, ...passes]);
            expect(passOrder(world, [...hud, ...passes])).toEqual([...passes, ...hud]);
        }
    });

    test("refuses a world that already renders through another backend and leaves it unchanged", () => {
        const world = newWorld();
        world.resources.insert(new GpuRenderBackend());
        expect(() => installPixelsBackend(world, new MemoryPixelPresenter(SIZE), PIXELS_SPRITE_PASSES)).toThrow("already renders through the gpu backend");
        expect(world.resources.tryGet(PixelPresenterResource)).toBeUndefined();
        expect(world.tryGetSystem(PixelRenderSystemGroup)).toBeUndefined();
    });
});
