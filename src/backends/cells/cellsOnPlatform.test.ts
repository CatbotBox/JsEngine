import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import {EntityQuery} from "../../engine/core/entityQuery";
import {getOwner} from "../../engine/core/ownership";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {RENDER_CAMERA_OVERRIDE_ERROR, RenderCameraOverride} from "../../engine/rendering/renderCameraOverride";
import {TextColor} from "../../engine/rendering/textColor";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {MeshRenderSettings} from "../../engine/rendering/3d/meshRenderSettings";
import {CellCameraSizingSystem} from "./cellCameraSizingSystem";
import {CellRenderSystemGroup} from "./cellRenderSystemGroup";
import {CellPresenterResource, CellRenderTargets} from "./cellPresenterResource";
import type {Entity} from "../../engine/core/entity";
import type {CellPresenter, CellPresenterSize, CellRepaint} from "./cellPresenter";
import {CellKind, copyCellFrame} from "./cellFrame";
import type {CellFrame} from "./cellFrame";
import {CellRenderSettings} from "./cellRenderSettings";
import {CellAspectRatio} from "./cellAspectRatio";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const DISABLED = false;

class RecordingPresenter implements CellPresenter {
    public readonly frames: {frame: CellFrame, repaint: CellRepaint}[] = [];
    public starts = 0;
    public stops = 0;
    public disposals = 0;
    private columns: number;
    private rows: number;
    private readonly reservedRows: number | undefined;
    private readonly resizeListeners = new Set<() => void>();

    public constructor(size: CellPresenterSize = {columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS}) {
        this.columns = size.columns;
        this.rows = size.rows;
        this.reservedRows = size.reservedRows;
    }

    public size(): CellPresenterSize {
        const reserved = this.reservedRows === undefined ? {} : {reservedRows: this.reservedRows};
        return {columns: this.columns, rows: this.rows, ...reserved};
    }

    public onResize(listener: () => void): () => void {
        this.resizeListeners.add(listener);
        return () => {
            this.resizeListeners.delete(listener);
        };
    }

    public resize(columns: number, rows: number): void {
        this.columns = columns;
        this.rows = rows;
        for (const listener of [...this.resizeListeners]) listener();
    }

    public get resizeListenerCount(): number {
        return this.resizeListeners.size;
    }

    public start(): void {
        this.starts++;
    }

    public stop(): void {
        this.stops++;
    }

    public dispose(): void {
        this.disposals++;
    }

    public present(frame: CellFrame, repaint: CellRepaint): void {
        this.frames.push({frame: copyCellFrame(frame), repaint});
    }
}

class CellPassProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

function worldPresentingOn(presenter: CellPresenter): World {
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new CellPresenterResource(presenter));
    return world;
}

function frameText(frame: CellFrame, row: number): string {
    let text = "";
    for (let x = 0; x < frame.width; x++) {
        const idx = row * frame.width + x;
        text += frame.kind[idx] === CellKind.Text ? String.fromCodePoint(frame.glyph[idx]) : " ";
    }
    return text.trimEnd();
}

describe("CellPresenterResource", () => {
    test("the render group starts the presenter the host inserted, stops it when disabled and disposes it when destroyed", () => {
        const presenter = new RecordingPresenter();
        const world = worldPresentingOn(presenter);
        expect(CellPresenterResource.presenterOf(world)).toBe(presenter);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        expect([presenter.starts, presenter.stops]).toEqual([1, 0]);
        group.enabled = false;
        expect([presenter.starts, presenter.stops]).toEqual([1, 1]);
        group.enabled = true;
        group.destroy();
        expect([presenter.starts, presenter.stops, presenter.disposals]).toEqual([2, 2, 1]);
    });

    test("world.stop stops and disposes the presenter once and destroys the passes, also after the rendering group was disabled", () => {
        for (const disableRenderingFirst of [false, true]) {
            const presenter = new RecordingPresenter();
            const world = worldPresentingOn(presenter);
            world.getOrCreateSystem(CellPassProbeSystem);
            world.getOrCreateSystem(CellCameraSizingSystem);
            if (disableRenderingFirst) world.tryGetSystem(RenderingSystemGroup)!.enabled = false;

            world.stop();

            expect([presenter.starts, presenter.stops, presenter.disposals]).toEqual([1, 1, 1]);
            expect(world.hasSystem(CellPassProbeSystem)).toBe(false);
            expect(presenter.resizeListenerCount).toBe(0);
        }
    });

    test("creating a cell system in a world without a presenter throws, naming the resource", () => {
        const sizingWorld = new World({platform: new MemoryPlatform()});
        expect(() => sizingWorld.getOrCreateSystem(CellCameraSizingSystem)).toThrow("CellPresenterResource");
        const renderWorld = new World({platform: new MemoryPlatform()});
        expect(() => renderWorld.getOrCreateSystem(CellRenderSystemGroup)).toThrow("CellPresenterResource");
    });

    test("the render group counts as a CPU renderer while it is enabled", () => {
        const world = worldPresentingOn(new RecordingPresenter());
        expect(world.renderers.framesRenderedOnCpu).toBe(false);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        expect(world.renderers.framesRenderedOnCpu).toBe(true);
        group.enabled = false;
        expect(world.renderers.framesRenderedOnCpu).toBe(false);
        group.enabled = true;
        world.stop();
        expect(world.renderers.count("cpu")).toBe(0);
    });
});

describe("CellRenderSystemGroup frames", () => {
    test("the first frame after enabling is a full repaint, later ones present changes", () => {
        const presenter = new RecordingPresenter({columns: 12, rows: 6});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        try {
            root.update();
            root.update();
            expect(presenter.frames.map(entry => entry.repaint)).toEqual(["full", "changes", "changes"]);
            const {frame} = presenter.frames[1];
            expect([frame.width, frame.height]).toEqual([12, 6]);
            expect(frame.backgroundStyle).toEqual(CellRenderSettings.DEFAULT_BACKGROUND_STYLE);
            expect(Array.from(frame.kind).every(kind => kind === CellKind.Background)).toBe(true);
        } finally {
            group.enabled = false;
        }
    });

    test("rows the presenter reserves are left out of the frame and the camera's screen size", () => {
        const presenter = new RecordingPresenter({columns: 12, rows: 6, reservedRows: 1});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        try {
            root.update();
            const {frame} = presenter.frames[presenter.frames.length - 1];
            expect([frame.width, frame.height]).toEqual([12, 5]);
            const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
            expect([size.x, size.y]).toEqual([12, 5]);
        } finally {
            group.enabled = false;
        }
    });

    test("the background style comes from the CellRenderSettings singleton", () => {
        const presenter = new RecordingPresenter({columns: 4, rows: 3});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        em.addComponent(em.createEntity("camera"), new Camera());
        const settings = new CellRenderSettings();
        settings.backgroundGlyph = "·";
        settings.backgroundGlyphColor = TextColor.BRIGHT_BLACK;
        settings.backgroundColor = TextColor.rgb(10, 20, 30);
        em.addComponent(em.createEntity("settings"), settings);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        try {
            root.update();
            expect(presenter.frames[presenter.frames.length - 1].frame.backgroundStyle).toEqual({
                glyph: 0xB7,
                foreground: TextColor.BRIGHT_BLACK,
                background: TextColor.rgb(10, 20, 30),
            });
        } finally {
            group.enabled = false;
        }
    });

    test("a duplicated camera is written into the frame as text, sized from the presenter, and skips the passes", () => {
        const presenter = new RecordingPresenter({columns: 50, rows: 4});
        const world = worldPresentingOn(presenter);
        const em = world.entityManager;
        em.addComponent(em.createEntity("camera 1"), new Camera());
        em.addComponent(em.createEntity("camera 2"), new Camera());
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(CellPassProbeSystem);
        try {
            group.update();
            const {frame, repaint} = presenter.frames[presenter.frames.length - 1];
            expect(repaint).toBe("full");
            expect([frame.width, frame.height]).toEqual([50, 4]);
            expect(frameText(frame, 0)).toBe("ERROR: MULTIPLE CAMERA ENTITIES FOUND (2)");
            expect(probe.frames).toBe(0);
        } finally {
            group.enabled = false;
        }
    });
});

describe("CellRenderSystemGroup render camera override", () => {
    test("a disabled override camera renders without a game camera, gets no CellAspectRatio and gets the presenter's size", () => {
        const presenter = new RecordingPresenter({columns: 60, rows: 20});
        const world = worldPresentingOn(presenter);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(CellPassProbeSystem);
        const camera = em.createEntity("override camera", [new Camera(), new LocalToWorld()]);
        em.setEnabledState(camera, DISABLED);
        try {
            root.update();
            expect([presenter.frames.length, probe.frames]).toEqual([0, 0]);
            world.resources.insert(new RenderCameraOverride(camera));
            root.update();
            root.update();
            expect([presenter.frames.length, probe.frames]).toEqual([2, 2]);
            expect(em.isEnabled(camera)).toBe(false);
            expect(em.getComponent(camera, CellAspectRatio)).toBeUndefined();
            const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
            expect([size.x, size.y]).toEqual([60, 20]);
        } finally {
            group.enabled = false;
        }
    });

    test("an override that names no live camera is written into the frame and skips the passes", () => {
        const presenter = new RecordingPresenter({columns: 70, rows: 4});
        const world = worldPresentingOn(presenter);
        const em = world.entityManager;
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(CellPassProbeSystem);
        try {
            world.resources.insert(new RenderCameraOverride(em.createEntity("not a camera")));
            group.update();
            const {frame, repaint} = presenter.frames[presenter.frames.length - 1];
            expect(repaint).toBe("full");
            expect(frameText(frame, 0)).toBe(RENDER_CAMERA_OVERRIDE_ERROR);
            expect(probe.frames).toBe(0);
        } finally {
            group.enabled = false;
        }
    });
});

class RenderedCameraProbeSystem extends System {
    public readonly cameras: Entity[] = [];

    override systemGroup() {
        return CellRenderSystemGroup;
    }

    onUpdate() {
        const override = this.world.resources.tryGet(RenderCameraOverride);
        if (override !== undefined) this.cameras.push(override.camera);
    }
}

function screenSizeOf(world: World, camera: Entity): number[] {
    const size = world.entityManager.getComponent<ScreenSize>(camera, ScreenSize)!;
    return [size.x, size.y];
}

describe("CellRenderSystemGroup render targets", () => {
    test("each target renders its own camera into its own presenter at its own size, and the host presenter draws only as a listed target", () => {
        const host = new RecordingPresenter({columns: 40, rows: 10});
        const scene = new RecordingPresenter({columns: 30, rows: 6});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(RenderedCameraProbeSystem);
        const gameCamera = em.createEntity("game camera", [new Camera()]);
        const sceneCamera = em.createEntity("scene camera", [new Camera(), new LocalToWorld()]);
        em.setEnabledState(sceneCamera, DISABLED);
        try {
            world.resources.insert(new CellRenderTargets([{camera: sceneCamera, presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            root.update();
            expect(probe.cameras).toEqual([sceneCamera, gameCamera, sceneCamera, gameCamera]);
            expect(scene.frames.map(({frame, repaint}) => [frame.width, frame.height, repaint])).toEqual([[30, 6, "full"], [30, 6, "changes"]]);
            expect(host.frames.map(({frame, repaint}) => [frame.width, frame.height, repaint])).toEqual([[40, 10, "full"], [40, 10, "changes"]]);
            expect([screenSizeOf(world, sceneCamera), screenSizeOf(world, gameCamera)]).toEqual([[30, 6], [40, 10]]);
            expect(em.getComponent(sceneCamera, CellAspectRatio)).toBeUndefined();
            expect(group.walkCount).toBe(4);

            world.resources.insert(new CellRenderTargets([{camera: sceneCamera, presenter: scene}]));
            root.update();
            expect([scene.frames.length, host.frames.length]).toEqual([3, 2]);

            world.resources.remove(CellRenderTargets);
            root.update();
            expect(world.resources.tryGet(RenderCameraOverride)).toBeUndefined();
            expect([scene.frames.length, host.frames.length]).toEqual([3, 3]);
            expect(host.frames[2].repaint).toBe("full");
        } finally {
            group.enabled = false;
        }
    });

    test("a resize re-sizes only its own target's camera, a zero-size target is skipped and keeps its camera's size", () => {
        const host = new RecordingPresenter({columns: 40, rows: 10});
        const scene = new RecordingPresenter({columns: 30, rows: 6});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const gameCamera = em.createEntity("game camera", [new Camera()]);
        const sceneCamera = em.createEntity("scene camera", [new Camera()]);
        em.setEnabledState(sceneCamera, DISABLED);
        try {
            world.resources.insert(new CellRenderTargets([{camera: sceneCamera, presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            scene.resize(20, 5);
            root.update();
            expect([screenSizeOf(world, sceneCamera), screenSizeOf(world, gameCamera)]).toEqual([[20, 5], [40, 10]]);
            scene.resize(0, 0);
            root.update();
            expect(screenSizeOf(world, sceneCamera)).toEqual([20, 5]);
            expect([scene.frames.length, host.frames.length]).toEqual([2, 3]);
            scene.resize(24, 8);
            root.update();
            expect(screenSizeOf(world, sceneCamera)).toEqual([24, 8]);
            expect(scene.frames.map(({repaint}) => repaint)).toEqual(["full", "changes", "full"]);
        } finally {
            group.enabled = false;
        }
    });

    test("a target without a camera draws nothing, a world camera target among several writes the error, and the render camera override comes back afterwards", () => {
        const host = new RecordingPresenter({columns: 70, rows: 4});
        const scene = new RecordingPresenter({columns: 30, rows: 6});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const probe = world.getOrCreateSystem(CellPassProbeSystem);
        const displaced = new RenderCameraOverride(em.createEntity("override camera", [new Camera()]));
        try {
            world.resources.insert(displaced);
            em.createEntity("camera 1", [new Camera()]);
            world.resources.insert(new CellRenderTargets([{camera: em.createEntity("not a camera"), presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            expect([scene.frames.length, probe.frames]).toEqual([0, 0]);
            expect(frameText(host.frames[0].frame, 0)).toBe("ERROR: MULTIPLE CAMERA ENTITIES FOUND (2)");
            world.resources.remove(CellRenderTargets);
            group.update();
            expect(world.resources.tryGet(RenderCameraOverride)).toBe(displaced);
        } finally {
            group.enabled = false;
        }
    });
});

describe("CellCameraSizingSystem", () => {
    test("sizes the camera from the surface and follows resizes", () => {
        const terminal = new RecordingPresenter({columns: 120, rows: 40});
        const world = worldPresentingOn(terminal);
        const sizing = world.getOrCreateSystem(CellCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
        expect(size.x).toBe(120);
        expect(size.y).toBe(40);

        terminal.resize(100, 30);
        root.update();
        expect(size.x).toBe(100);
        expect(size.y).toBe(30);

        sizing.destroy();
        expect(terminal.resizeListenerCount).toBe(0);
    });

    test("sizes a camera that replaced the sized one without a resize", () => {
        const world = worldPresentingOn(new RecordingPresenter({columns: 120, rows: 40}));
        world.getOrCreateSystem(CellCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const replaced = em.createEntity("camera");
        em.addComponent(replaced, new Camera());
        root.update();
        em.destroyEntity(replaced);
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
        expect([size.x, size.y]).toEqual([120, 40]);
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

    test("rendering game, override and target cameras without a CellAspectRatio makes no structural change", () => {
        const host = new RecordingPresenter({columns: 40, rows: 10});
        const scene = new RecordingPresenter({columns: 30, rows: 6});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(CellRenderSystemGroup);
        const gameCamera = em.createEntity("game camera", [new Camera()]);
        const sceneCamera = em.createEntity("scene camera", [new Camera(), new LocalToWorld()]);
        const overrideCamera = em.createEntity("override camera", [new Camera(), new LocalToWorld()]);
        em.setEnabledState(sceneCamera, DISABLED);
        em.setEnabledState(overrideCamera, DISABLED);
        const cameras = [gameCamera, sceneCamera, overrideCamera];
        const archetypesBefore = cameras.map(camera => getOwner(world, camera));
        try {
            root.update();
            world.resources.insert(new RenderCameraOverride(overrideCamera));
            root.update();
            world.resources.remove(RenderCameraOverride);
            world.resources.insert(new CellRenderTargets([{camera: sceneCamera, presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            expect([host.frames.length, scene.frames.length]).toEqual([3, 1]);
            expect(cameras.map((camera, i) => getOwner(world, camera) === archetypesBefore[i])).toEqual([true, true, true]);
            expect(new EntityQuery(world, [CellAspectRatio]).enabledEntityCount()).toBe(0);
        } finally {
            group.enabled = false;
        }
    });

    test("keeps a camera's existing CellAspectRatio", () => {
        const world = worldPresentingOn(new RecordingPresenter());
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
        expect(new EntityQuery(world, [CellAspectRatio]).enabledEntityCount()).toBe(1);
    });
});

describe("MeshCellPassSettings worker count", () => {
    const resolve = (platform: MemoryPlatform, workerCount: number | "auto" = "auto") => {
        const settings = new MeshCellPassSettings();
        settings.workerCount = workerCount;
        return settings.toRasterizerConfig(platform, new MeshRenderSettings()).workerCount;
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
