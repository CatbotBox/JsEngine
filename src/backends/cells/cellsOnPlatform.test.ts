import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import {EntityQuery} from "../../engine/core/entityQuery";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {TextColor} from "../../engine/rendering/textColor";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {CellCameraSizingSystem} from "./cellCameraSizingSystem";
import {CellRenderSystemGroup} from "./cellRenderSystemGroup";
import {CellPresenterResource} from "./cellPresenterResource";
import type {CellPresenter, CellPresenterSize, CellRepaint} from "./cellPresenter";
import {CellKind, copyCellFrame} from "./cellFrame";
import type {CellFrame} from "./cellFrame";
import {CellRenderSettings} from "./cellRenderSettings";
import {CellAspectRatio} from "./cellAspectRatio";
import {MeshCellPassSettings} from "./3d/meshCellPassSettings";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

class RecordingPresenter implements CellPresenter {
    public readonly frames: {frame: CellFrame, repaint: CellRepaint}[] = [];
    public starts = 0;
    public stops = 0;
    public disposals = 0;
    private columns: number;
    private rows: number;
    private readonly resizeListeners = new Set<() => void>();

    public constructor(size: CellPresenterSize = {columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS}) {
        this.columns = size.columns;
        this.rows = size.rows;
    }

    public size(): CellPresenterSize {
        return {columns: this.columns, rows: this.rows};
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
            expect([frame.width, frame.height]).toEqual([12, 5]);
            expect(frame.backgroundStyle).toEqual(CellRenderSettings.DEFAULT_BACKGROUND_STYLE);
            expect(Array.from(frame.kind).every(kind => kind === CellKind.Background)).toBe(true);
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
            expect([frame.width, frame.height]).toEqual([50, 3]);
            expect(frameText(frame, 0)).toBe("ERROR: MULTIPLE CAMERA ENTITIES FOUND (2)");
            expect(probe.frames).toBe(0);
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
        const world = worldPresentingOn(new RecordingPresenter());
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
        expect(new EntityQuery(world, [CellAspectRatio]).enabledEntityCount()).toBe(1);
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
