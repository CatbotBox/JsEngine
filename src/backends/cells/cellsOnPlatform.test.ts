import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform, MemoryTerminal} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import {EntityQuery} from "../../engine/core/entityQuery";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {CellCameraSizingSystem} from "./cellCameraSizingSystem";
import {CellRenderSystemGroup} from "./cellRenderSystemGroup";
import {CellSurfaceResource} from "./cellSurfaceResource";
import {CellAspectRatio} from "./cellAspectRatio";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

function worldDrawingOn(terminal: MemoryTerminal): World {
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new CellSurfaceResource(terminal));
    return world;
}

describe("CellSurfaceResource", () => {
    test("cell systems read the surface the host inserted", () => {
        const terminal = new MemoryTerminal();
        const world = worldDrawingOn(terminal);
        expect(CellSurfaceResource.surfaceOf(world)).toBe(terminal);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        expect(terminal.text().length).toBeGreaterThan(0);
        group.enabled = false;
    });

    test("creating a cell system in a world without a surface throws, naming the resource", () => {
        const sizingWorld = new World({platform: new MemoryPlatform()});
        expect(() => sizingWorld.getOrCreateSystem(CellCameraSizingSystem)).toThrow("CellSurfaceResource");
        const renderWorld = new World({platform: new MemoryPlatform()});
        expect(() => renderWorld.getOrCreateSystem(CellRenderSystemGroup)).toThrow("CellSurfaceResource");
    });
});

describe("CellCameraSizingSystem", () => {
    test("sizes the camera from the surface and follows resizes", () => {
        const terminal = new MemoryTerminal({columns: 120, rows: 40});
        const world = worldDrawingOn(terminal);
        const sizing = world.getOrCreateSystem(CellCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
        expect(size.x).toBe(120);
        expect(size.y).toBe(39);

        terminal.resize(100, 30);
        root.update();
        expect(size.x).toBe(100);
        expect(size.y).toBe(29);

        sizing.destroy();
        expect(terminal.resizeListenerCount).toBe(0);
    });

    test("a camera gets no CellAspectRatio without the console sizing system", () => {
        const world = new World({platform: new MemoryPlatform()});
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        expect(em.getComponent(camera, CellAspectRatio)).toBeUndefined();
    });

    test("adds exactly one CellAspectRatio, before the render passes of the same frame", () => {
        const world = worldDrawingOn(new MemoryTerminal());
        world.getOrCreateSystem(CellCameraSizingSystem);
        const probe = world.getOrCreateSystem(CellRatioProbeSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        expect(probe.sawCellRatio).toBe(true);
        expect(em.getComponent<CellAspectRatio>(camera, CellAspectRatio)!.value).toBe(2);
        root.update();
        expect(new EntityQuery(world, [CellAspectRatio]).entityCount()).toBe(1);
    });

    test("keeps a camera's existing CellAspectRatio", () => {
        const world = worldDrawingOn(new MemoryTerminal());
        world.getOrCreateSystem(CellCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        const ratio = new CellAspectRatio();
        ratio.value = 3;
        em.addComponent(camera, ratio);
        root.update();
        expect(em.getComponent<CellAspectRatio>(camera, CellAspectRatio)!.value).toBe(3);
        expect(new EntityQuery(world, [CellAspectRatio]).entityCount()).toBe(1);
    });
});

class CellRatioProbeSystem extends System {
    private _cameraQuery = this.createEntityQuery([Camera, CellAspectRatio]);
    public sawCellRatio = false;

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return 100;
    }

    onUpdate() {
        this.sawCellRatio = this._cameraQuery.hasEntity();
    }
}

describe("MeshCellPassSettings worker count", () => {
    const resolve = (platform: MemoryPlatform, workerCount: number | "auto" = "auto") => {
        const settings = new MeshCellPassSettings();
        settings.workerCount = workerCount;
        return settings.toRasterizerConfig(platform).workerCount;
    };

    test("auto leaves one core to the main thread, up to 7 workers", () => {
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 1}))).toBe(0);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 4}))).toBe(3);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 32}))).toBe(7);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 0}))).toBe(0);
    });

    test("auto takes the host's requested count, clamped to [0, 15]", () => {
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 32, requestedRasterWorkers: 2}))).toBe(2);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 1, requestedRasterWorkers: 12}))).toBe(12);
        expect(resolve(new MemoryPlatform({requestedRasterWorkers: 64}))).toBe(15);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 8, requestedRasterWorkers: -3}))).toBe(0);
    });

    test("an explicit count passes through", () => {
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 32}), 0)).toBe(0);
        expect(resolve(new MemoryPlatform({hardwareConcurrency: 1, requestedRasterWorkers: 9}), 3)).toBe(3);
    });
});
