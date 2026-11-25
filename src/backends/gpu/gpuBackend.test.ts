import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {System} from "../../engine/core/system";
import {activeRenderBackend, CellsRenderBackend, GpuRenderBackend, PixelsRenderBackend} from "../../engine/rendering/renderBackend";
import type {RenderPassCtor} from "../../engine/rendering/renderPasses";
import {MemoryPixelPresenter} from "../pixels/memoryPixelPresenter";
import {PixelPresenterResource} from "../pixels/pixelPresenterResource";
import {PixelRenderSystemGroup} from "../pixels/pixelRenderSystemGroup";
import {PIXELS_HUD_TEXT_PASSES} from "../pixels/pixelsHudTextPasses";
import {PIXELS_SPRITE_PASSES} from "../pixels/2d/pixelsSpritePasses";
import {installGpuBackend} from "./gpuBackend";
import {GpuCanvasPixelPresenter} from "./gpuCanvasPixelPresenter";
import {GpuDeviceResource} from "./gpuDeviceResource";
import {GpuFrame} from "./gpuFrame";
import {GPU_MESH_PASSES} from "./gpuMeshPasses";
import {PIXELS_2D_AND_HUD_PASSES} from "../pixels/pixelsStandardPasses";
import {GPU_PASS_LISTS, GPU_STANDARD_PASSES} from "./gpuStandardPasses";
import {ConsoleRecorder} from "./testing/consoleRecorder";
import {FakeCanvas, FakeCanvasContext, FakeGpuDevice} from "./testing/fakeGpuDevice";

const FORMAT: GPUTextureFormat = "bgra8unorm";
const SIZE = {widthPx: 64, heightPx: 48};

const recorders: ConsoleRecorder[] = [];

afterEach(() => {
    for (const recorder of recorders.splice(0)) recorder.detach();
});

function ignore(): void {
}

function newWorld(): World {
    recorders.push(new ConsoleRecorder());
    return new World({platform: new MemoryPlatform()});
}

function fakeGpu(): GpuDeviceResource {
    const device = new FakeGpuDevice();
    const canvas = new FakeCanvas();
    return new GpuDeviceResource(device, new GpuFrame(device, new FakeCanvasContext(canvas, FORMAT), canvas, FORMAT));
}

function passOrder(world: World, passes: readonly RenderPassCtor[]): Function[] {
    const isListed = (system: System) => passes.some(pass => system instanceof pass);
    return world.tryGetSystem(PixelRenderSystemGroup)!.systems.filter(isListed).map(system => system.constructor);
}

describe("installGpuBackend", () => {
    test("the standard passes are the pass lists in order: the gpu mesh pass, then the pixels 2D and HUD passes", () => {
        expect(GPU_PASS_LISTS.flat()).toEqual([...GPU_STANDARD_PASSES]);
        expect(GPU_PASS_LISTS.filter(list => list !== GPU_MESH_PASSES).flat()).toEqual([...PIXELS_2D_AND_HUD_PASSES]);
    });

    test("inserts the device, the presenter and only the gpu marker, although its 2D and HUD passes are pixel systems", () => {
        const world = newWorld();
        const gpu = fakeGpu();
        const presenter = new GpuCanvasPixelPresenter(new MemoryPixelPresenter(SIZE), gpu, ignore);
        installGpuBackend(world, gpu, presenter, [...GPU_MESH_PASSES, ...PIXELS_SPRITE_PASSES, ...PIXELS_HUD_TEXT_PASSES]);
        expect(GpuDeviceResource.deviceOf(world)).toBe(gpu);
        expect(PixelPresenterResource.presenterOf(world)).toBe(presenter);
        expect(world.resources.tryGet(GpuRenderBackend)).toBeDefined();
        expect(world.resources.tryGet(PixelsRenderBackend)).toBeUndefined();
        expect(world.resources.tryGet(CellsRenderBackend)).toBeUndefined();
        expect(activeRenderBackend(world)).toBe("gpu");
    });

    test("creates the passes in the order given, which decides equal priorities", () => {
        for (const passes of [[...GPU_MESH_PASSES, ...PIXELS_SPRITE_PASSES], [...PIXELS_SPRITE_PASSES, ...GPU_MESH_PASSES]]) {
            const world = newWorld();
            const gpu = fakeGpu();
            installGpuBackend(world, gpu, new GpuCanvasPixelPresenter(new MemoryPixelPresenter(SIZE), gpu, ignore), passes);
            expect(passOrder(world, passes)).toEqual(passes);
        }
    });

    test("refuses a world that already renders through another backend and leaves it unchanged", () => {
        const world = newWorld();
        world.resources.insert(new PixelsRenderBackend());
        const gpu = fakeGpu();
        expect(() => installGpuBackend(world, gpu, new MemoryPixelPresenter(SIZE), GPU_MESH_PASSES)).toThrow("already renders through the pixels backend");
        expect(world.resources.tryGet(GpuDeviceResource)).toBeUndefined();
        expect(world.resources.tryGet(PixelPresenterResource)).toBeUndefined();
    });
});

describe("GpuCanvasPixelPresenter", () => {
    test("holds frames back while the surface it draws for is backlogged, and reports that surface's presentations as well as the GPU's", () => {
        const gpu = fakeGpu();
        let surfaceBacklogged = true;
        const surfaceListeners: (() => void)[] = [];
        const presenter = new GpuCanvasPixelPresenter({
            size: () => SIZE,
            onResize: () => ignore,
            backlogged: () => surfaceBacklogged,
            onPresented: listener => {
                surfaceListeners.push(listener);
                return () => surfaceListeners.splice(surfaceListeners.indexOf(listener), 1);
            },
        }, gpu, ignore);
        let presentations = 0;
        const stopListening = presenter.onPresented(() => presentations++);
        expect(presenter.backlogged()).toBe(true);
        surfaceBacklogged = false;
        for (const listener of [...surfaceListeners]) listener();
        expect([presenter.backlogged(), presentations]).toEqual([false, 1]);
        stopListening();
        expect(surfaceListeners.length).toBe(0);
        expect(new GpuCanvasPixelPresenter(new MemoryPixelPresenter(SIZE), gpu, ignore).backlogged()).toBe(false);
    });
});
