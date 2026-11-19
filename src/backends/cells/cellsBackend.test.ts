import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {System} from "../../engine/core/system";
import {activeRenderBackend, CellsRenderBackend, GpuRenderBackend, PixelsRenderBackend} from "../../engine/rendering/renderBackend";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import type {CellPresenter} from "./cellPresenter";
import {CellPresenterResource} from "./cellPresenterResource";
import {CellRenderSystemGroup} from "./cellRenderSystemGroup";
import {installCellsBackend} from "./cellsBackend";
import {CELLS_HUD_TEXT_PASSES} from "./cellsHudTextPasses";
import {CELLS_SPRITE_PASSES} from "./2d/cellsSpritePasses";
import {CELLS_WORLD_TEXT_PASSES} from "./2d/cellsWorldTextPasses";
import {CELLS_MESH_PASSES} from "./3d/cellsMeshPasses";

const COLUMNS = 80;
const ROWS = 24;
const NO_PASSES: readonly RenderPassCtor[] = [];

function idlePresenter(): CellPresenter {
    return {
        size: () => ({columns: COLUMNS, rows: ROWS}),
        onResize: () => () => undefined,
        start: () => undefined,
        stop: () => undefined,
        present: () => undefined,
    };
}

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

function passOrder(world: World, passes: readonly RenderPassCtor[]): Function[] {
    const isListed = (system: System) => passes.some(pass => system instanceof pass);
    return world.tryGetSystem(CellRenderSystemGroup)!.systems.filter(isListed).map(system => system.constructor);
}

describe("installCellsBackend", () => {
    test("inserts the presenter and only the cells marker", () => {
        const world = newWorld();
        const presenter = idlePresenter();
        installCellsBackend(world, presenter, NO_PASSES);
        expect(CellPresenterResource.presenterOf(world)).toBe(presenter);
        expect(world.resources.tryGet(CellsRenderBackend)).toBeDefined();
        expect(world.resources.tryGet(PixelsRenderBackend)).toBeUndefined();
        expect(world.resources.tryGet(GpuRenderBackend)).toBeUndefined();
        expect(activeRenderBackend(world)).toBe("cells");
    });

    test("creates the passes in the order given, which decides equal priorities", () => {
        const spritesFirst = [...CELLS_SPRITE_PASSES, ...CELLS_WORLD_TEXT_PASSES, ...CELLS_MESH_PASSES];
        const meshesFirst = [...CELLS_MESH_PASSES, ...CELLS_WORLD_TEXT_PASSES, ...CELLS_SPRITE_PASSES];
        for (const passes of [spritesFirst, meshesFirst]) {
            const world = newWorld();
            installCellsBackend(world, idlePresenter(), [...passes, ...CELLS_HUD_TEXT_PASSES]);
            expect(passOrder(world, [...passes, ...CELLS_HUD_TEXT_PASSES])).toEqual([...passes, ...CELLS_HUD_TEXT_PASSES]);
        }
    });

    test("refuses a world that already renders through another backend and leaves it unchanged", () => {
        const world = newWorld();
        world.resources.insert(new PixelsRenderBackend());
        expect(() => installCellsBackend(world, idlePresenter(), CELLS_SPRITE_PASSES)).toThrow("already renders through the pixels backend");
        expect(world.resources.tryGet(CellPresenterResource)).toBeUndefined();
        expect(world.tryGetSystem(CellRenderSystemGroup)).toBeUndefined();
        expect(activeRenderBackend(world)).toBe("pixels");
    });
});
