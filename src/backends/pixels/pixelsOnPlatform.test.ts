import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import type {Entity} from "../../engine/core/entity";
import {LocalToWorld} from "../../engine/translation/localToWorld";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {RenderCameraOverride} from "../../engine/rendering/renderCameraOverride";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {DEFAULT_TEXT_FOREGROUND_RGB} from "../../engine/rendering/textColorPalette";
import {MemoryPixelPresenter} from "./memoryPixelPresenter";
import {PixelPresenterResource, PixelRenderTargets} from "./pixelPresenterResource";
import {PixelFramebuffer} from "./pixelFramebuffer";
import {PixelRenderSystemGroup} from "./pixelRenderSystemGroup";
import {PixelCameraSizingSystem} from "./pixelCameraSizingSystem";
import {PixelRenderSettings} from "./pixelRenderSettings";
import {RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";

const BACKGROUND_RGB = 0x203040;
const RED_SHIFT = 16, GREEN_SHIFT = 8;
const DISABLED = false;

class PixelPassProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
    }
}

class PresentationReportingPresenter extends MemoryPixelPresenter {
    private readonly presentedListeners = new Set<() => void>();

    public onPresented(listener: () => void): () => void {
        this.presentedListeners.add(listener);
        return () => {
            this.presentedListeners.delete(listener);
        };
    }

    public get presentedListenerCount(): number {
        return this.presentedListeners.size;
    }

    public reportPresented(): void {
        for (const listener of [...this.presentedListeners]) listener();
    }
}

function worldPresentingOn(presenter: MemoryPixelPresenter): World {
    const world = new World({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(presenter));
    return world;
}

function rgbAt(frame: PixelFrame, x: number, y: number): number {
    const i = (y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

function countRgb(frame: PixelFrame, rgb: number): number {
    let count = 0;
    for (let y = 0; y < frame.heightPx; y++) for (let x = 0; x < frame.widthPx; x++) if (rgbAt(frame, x, y) === rgb) count++;
    return count;
}

describe("PixelPresenterResource", () => {
    test("the render group starts the presenter the host inserted, stops it when disabled and disposes it when destroyed", () => {
        const presenter = new MemoryPixelPresenter();
        const world = worldPresentingOn(presenter);
        expect(PixelPresenterResource.presenterOf(world)).toBe(presenter);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        expect([presenter.starts, presenter.stops]).toEqual([1, 0]);
        group.enabled = false;
        expect([presenter.starts, presenter.stops]).toEqual([1, 1]);
        group.enabled = true;
        group.destroy();
        expect([presenter.starts, presenter.stops, presenter.disposals]).toEqual([2, 2, 1]);
    });

    test("world.stop stops and disposes the presenter once and destroys the passes, also after the rendering group was disabled", () => {
        for (const disableRenderingFirst of [false, true]) {
            const presenter = new MemoryPixelPresenter();
            const world = worldPresentingOn(presenter);
            world.getOrCreateSystem(PixelPassProbeSystem);
            world.getOrCreateSystem(PixelCameraSizingSystem);
            if (disableRenderingFirst) world.tryGetSystem(RenderingSystemGroup)!.enabled = false;

            world.stop();

            expect([presenter.starts, presenter.stops, presenter.disposals]).toEqual([1, 1, 1]);
            expect(world.hasSystem(PixelPassProbeSystem)).toBe(false);
            expect(world.hasSystem(PixelCameraSizingSystem)).toBe(false);
        }
    });

    test("creating a pixel system in a world without a presenter throws, naming the resource", () => {
        const sizingWorld = new World({platform: new MemoryPlatform()});
        expect(() => sizingWorld.getOrCreateSystem(PixelCameraSizingSystem)).toThrow("PixelPresenterResource");
        const renderWorld = new World({platform: new MemoryPlatform()});
        expect(() => renderWorld.getOrCreateSystem(PixelRenderSystemGroup)).toThrow("PixelPresenterResource");
    });
});

describe("PixelRenderSystemGroup frames", () => {
    test("presents a frame when enabled and one per update at the presenter's size, filled with the default black background", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 24, heightPx: 32});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        world.entityManager.addComponent(world.entityManager.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        try {
            root.update();
            root.update();
            expect(presenter.frames.length).toBe(3);
            const frame = presenter.lastFrame!;
            expect([frame.widthPx, frame.heightPx, frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY]).toEqual([24, 32, 8, 16]);
            expect(countRgb(frame, PixelRenderSettings.DEFAULT_BACKGROUND_COLOR)).toBe(24 * 32);
        } finally {
            group.enabled = false;
        }
    });

    test("the background and screen unit come from the PixelRenderSettings singleton", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 12, heightPx: 12});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        em.addComponent(em.createEntity("camera"), new Camera());
        const settings = new PixelRenderSettings();
        settings.backgroundColor = BACKGROUND_RGB;
        settings.pixelsPerScreenUnitX = 3.7;
        em.addComponent(em.createEntity("settings"), settings);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        try {
            root.update();
            const frame = presenter.lastFrame!;
            expect([frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY]).toEqual([3, 6]);
            expect(countRgb(frame, BACKGROUND_RGB)).toBe(12 * 12);
        } finally {
            group.enabled = false;
        }
    });

    test("a presenter that reports presented frames paces the loop through the world's presenter backlogs while the group is enabled", () => {
        const presenter = new PresentationReportingPresenter();
        const world = worldPresentingOn(presenter);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const backlogs = world.presenterBacklogs;
        let presented = 0;
        backlogs.onPresented(() => presented++);
        expect([backlogs.count, backlogs.backlogged()]).toEqual([1, false]);
        presenter.isBacklogged = true;
        expect(backlogs.backlogged()).toBe(true);
        presenter.reportPresented();
        expect(presented).toBe(1);
        group.enabled = false;
        expect([backlogs.count, backlogs.backlogged(), presenter.presentedListenerCount]).toEqual([0, false, 0]);
        group.enabled = true;
        expect(backlogs.count).toBe(1);
        group.destroy();
        expect(backlogs.count).toBe(0);
    });

    test("a presenter without presented frames leaves the loop unpaced", () => {
        const world = worldPresentingOn(new MemoryPixelPresenter());
        world.getOrCreateSystem(PixelRenderSystemGroup);
        expect(world.presenterBacklogs.count).toBe(0);
    });

    test("a backlogged presenter gets no frame and the passes skip", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 8, heightPx: 8});
        const world = worldPresentingOn(presenter);
        const em = world.entityManager;
        em.addComponent(em.createEntity("camera"), new Camera());
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelPassProbeSystem);
        try {
            group.update();
            const presented = presenter.frames.length, probed = probe.frames;
            presenter.isBacklogged = true;
            group.update();
            expect([presenter.frames.length, probe.frames]).toEqual([presented, probed]);
            presenter.isBacklogged = false;
            group.update();
            expect(presenter.frames.length).toBe(presented + 1);
        } finally {
            group.enabled = false;
        }
    });

    test("a duplicated camera is written into the frame in the pixel font and skips the passes", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 400, heightPx: 48});
        const world = worldPresentingOn(presenter);
        const em = world.entityManager;
        em.addComponent(em.createEntity("camera 1"), new Camera());
        em.addComponent(em.createEntity("camera 2"), new Camera());
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelPassProbeSystem);
        try {
            group.update();
            const frame = presenter.lastFrame!;
            expect([frame.widthPx, frame.heightPx]).toEqual([400, 48]);
            const firstRowText = countRgb({...frame, heightPx: 16, rgba: frame.rgba.subarray(0, 400 * 16 * RGBA_BYTES_PER_PIXEL)}, DEFAULT_TEXT_FOREGROUND_RGB);
            expect(firstRowText).toBeGreaterThan(0);
            expect(countRgb(frame, DEFAULT_TEXT_FOREGROUND_RGB)).toBe(firstRowText);
            expect(rgbAt(frame, 0, 0)).toBe(DEFAULT_TEXT_FOREGROUND_RGB);
            expect(probe.frames).toBe(0);
        } finally {
            group.enabled = false;
        }
    });
});

function disabledCamera(world: World): Entity {
    const em = world.entityManager;
    const camera = em.createEntity("override camera", [new Camera(), new LocalToWorld()]);
    em.setEnabledState(camera, DISABLED);
    return camera;
}

function screenSizeOf(world: World, camera: Entity): number[] {
    const size = world.entityManager.getComponent<ScreenSize>(camera, ScreenSize)!;
    return [size.x, size.y];
}

describe("PixelRenderSystemGroup render camera override", () => {
    test("without a game camera nothing renders until an override names a camera, which the presenter sizes", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 640, heightPx: 384});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelPassProbeSystem);
        const camera = disabledCamera(world);
        try {
            root.update();
            expect([presenter.frames.length, probe.frames]).toEqual([0, 0]);

            world.resources.insert(new RenderCameraOverride(camera));
            root.update();
            expect([presenter.frames.length, probe.frames]).toEqual([1, 1]);
            expect(screenSizeOf(world, camera)).toEqual([80, 24]);
            presenter.resize(320, 160);
            root.update();
            expect(screenSizeOf(world, camera)).toEqual([40, 10]);

            world.resources.remove(RenderCameraOverride);
            root.update();
            expect([presenter.frames.length, probe.frames]).toEqual([2, 2]);
        } finally {
            group.enabled = false;
        }
    });

    test("the override wins over several game cameras, which still report as an error without it", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 64, heightPx: 32});
        const world = worldPresentingOn(presenter);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        em.addComponent(em.createEntity("camera 1"), new Camera());
        em.addComponent(em.createEntity("camera 2"), new Camera());
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelPassProbeSystem);
        try {
            world.resources.insert(new RenderCameraOverride(disabledCamera(world)));
            root.update();
            expect(probe.frames).toBe(1);
            world.resources.remove(RenderCameraOverride);
            root.update();
            expect(probe.frames).toBe(1);
            expect(rgbAt(presenter.lastFrame!, 0, 0)).toBe(DEFAULT_TEXT_FOREGROUND_RGB);
        } finally {
            group.enabled = false;
        }
    });

    test("an override that names no live camera is written into the frame and skips the passes", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 64, heightPx: 32});
        const world = worldPresentingOn(presenter);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelPassProbeSystem);
        const camera = disabledCamera(world);
        try {
            world.resources.insert(new RenderCameraOverride(camera));
            world.entityManager.destroyEntity(camera);
            root.update();
            expect(presenter.frames.length).toBe(1);
            expect(rgbAt(presenter.lastFrame!, 0, 0)).toBe(DEFAULT_TEXT_FOREGROUND_RGB);
            expect(probe.frames).toBe(0);
        } finally {
            group.enabled = false;
        }
    });
});

class RenderedCameraProbeSystem extends System {
    public readonly cameras: Entity[] = [];
    public readonly framebufferWidths: number[] = [];

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    onUpdate() {
        const override = this.world.resources.tryGet(RenderCameraOverride);
        if (override !== undefined) this.cameras.push(override.camera);
        this.framebufferWidths.push(this.world.resources.get(PixelFramebuffer).widthPx);
    }
}

describe("PixelRenderSystemGroup render targets", () => {
    test("each target renders its own camera into its own framebuffer and presenter, sized by it; the host presenter draws only as a listed target", () => {
        const host = new MemoryPixelPresenter({widthPx: 640, heightPx: 384});
        const scene = new MemoryPixelPresenter({widthPx: 320, heightPx: 160});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(RenderedCameraProbeSystem);
        const gameCamera = em.createEntity("game camera", [new Camera()]);
        const sceneCamera = disabledCamera(world);
        try {
            world.resources.insert(new PixelRenderTargets([{camera: sceneCamera, presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            root.update();
            expect(probe.cameras).toEqual([sceneCamera, gameCamera, sceneCamera, gameCamera]);
            expect(probe.framebufferWidths).toEqual([320, 640, 320, 640]);
            expect([scene.frames.length, host.frames.length]).toEqual([2, 2]);
            expect([scene.lastFrame!.widthPx, host.lastFrame!.widthPx]).toEqual([320, 640]);
            expect([screenSizeOf(world, sceneCamera), screenSizeOf(world, gameCamera)]).toEqual([[40, 10], [80, 24]]);
            expect(PixelPresenterResource.presenterOf(world)).toBe(host);
            expect(group.walkCount).toBe(4);

            world.resources.remove(PixelRenderTargets);
            root.update();
            expect(world.resources.tryGet(RenderCameraOverride)).toBeUndefined();
            expect([scene.frames.length, host.frames.length]).toEqual([2, 3]);
        } finally {
            group.enabled = false;
        }
    });

    test("a backlogged or zero-size target is skipped without holding up the others, and keeps its camera's size", () => {
        const host = new MemoryPixelPresenter({widthPx: 640, heightPx: 384});
        const scene = new MemoryPixelPresenter({widthPx: 320, heightPx: 160});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const gameCamera = em.createEntity("game camera", [new Camera()]);
        const sceneCamera = disabledCamera(world);
        try {
            world.resources.insert(new PixelRenderTargets([{camera: sceneCamera, presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            scene.isBacklogged = true;
            root.update();
            expect([scene.frames.length, host.frames.length]).toEqual([1, 2]);
            scene.isBacklogged = false;
            scene.resize(0, 0);
            host.resize(160, 64);
            root.update();
            expect([scene.frames.length, host.frames.length]).toEqual([1, 3]);
            expect([screenSizeOf(world, sceneCamera), screenSizeOf(world, gameCamera)]).toEqual([[40, 10], [20, 4]]);
            scene.resize(480, 320);
            root.update();
            expect(screenSizeOf(world, sceneCamera)).toEqual([60, 20]);
            expect(scene.frames.length).toBe(2);
        } finally {
            group.enabled = false;
        }
    });

    test("each target presenter that reports presentation registers its backlog while it is listed and the group is enabled", () => {
        const host = new PresentationReportingPresenter();
        const scene = new PresentationReportingPresenter();
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        em.createEntity("game camera", [new Camera()]);
        const backlogs = world.presenterBacklogs;
        expect(backlogs.count).toBe(1);
        world.resources.insert(new PixelRenderTargets([{camera: disabledCamera(world), presenter: scene}, {camera: undefined, presenter: host}]));
        root.update();
        expect([backlogs.count, scene.presentedListenerCount]).toEqual([2, 1]);
        scene.isBacklogged = true;
        expect(backlogs.backlogged()).toBe(true);
        group.enabled = false;
        expect([backlogs.count, scene.presentedListenerCount]).toEqual([0, 0]);
        group.enabled = true;
        expect(backlogs.count).toBe(2);
        world.resources.insert(new PixelRenderTargets([{camera: undefined, presenter: host}]));
        root.update();
        expect([backlogs.count, scene.presentedListenerCount]).toEqual([1, 0]);
        group.enabled = false;
    });

    test("a target without a camera draws nothing, a world camera target among several writes the error, and a displaced override comes back", () => {
        const host = new MemoryPixelPresenter({widthPx: 64, heightPx: 32});
        const scene = new MemoryPixelPresenter({widthPx: 64, heightPx: 32});
        const world = worldPresentingOn(host);
        const em = world.entityManager;
        const root = world.getOrCreateSystem(RootSystemGroup);
        const group = world.getOrCreateSystem(PixelRenderSystemGroup);
        const probe = world.getOrCreateSystem(PixelPassProbeSystem);
        const displaced = new RenderCameraOverride(disabledCamera(world));
        try {
            em.createEntity("camera 1", [new Camera()]);
            em.createEntity("camera 2", [new Camera()]);
            world.resources.insert(displaced);
            world.resources.insert(new PixelRenderTargets([{camera: em.createEntity("not a camera"), presenter: scene}, {camera: undefined, presenter: host}]));
            root.update();
            expect([scene.frames.length, host.frames.length, probe.frames]).toEqual([0, 1, 0]);
            expect(rgbAt(host.lastFrame!, 0, 0)).toBe(DEFAULT_TEXT_FOREGROUND_RGB);
            world.resources.remove(PixelRenderTargets);
            group.update();
            expect(world.resources.tryGet(RenderCameraOverride)).toBe(displaced);
        } finally {
            group.enabled = false;
        }
    });
});

describe("PixelCameraSizingSystem", () => {
    test("sizes the camera in screen units, fractional when the surface is, and follows resizes", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 640, heightPx: 384});
        const world = worldPresentingOn(presenter);
        const sizing = world.getOrCreateSystem(PixelCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        root.update();
        const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
        expect([size.x, size.y]).toEqual([80, 24]);

        presenter.resize(644, 392);
        root.update();
        expect([size.x, size.y]).toEqual([80.5, 24.5]);

        sizing.destroy();
        expect(presenter.resizeListenerCount).toBe(0);
    });

    test("follows a change of the screen unit in the settings without a resize", () => {
        const presenter = new MemoryPixelPresenter({widthPx: 320, heightPx: 160});
        const world = worldPresentingOn(presenter);
        world.getOrCreateSystem(PixelCameraSizingSystem);
        const root = world.getOrCreateSystem(RootSystemGroup);
        const em = world.entityManager;
        const camera = em.createEntity("camera");
        em.addComponent(camera, new Camera());
        const settings = new PixelRenderSettings();
        em.addComponent(em.createEntity("settings"), settings);
        root.update();
        const size = em.getComponent<ScreenSize>(camera, ScreenSize)!;
        expect([size.x, size.y]).toEqual([40, 10]);
        settings.pixelsPerScreenUnitX = 4;
        root.update();
        expect([size.x, size.y]).toEqual([80, 20]);
    });

    test("sizes a camera that replaced the sized one without a resize", () => {
        const world = worldPresentingOn(new MemoryPixelPresenter({widthPx: 640, heightPx: 384}));
        world.getOrCreateSystem(PixelCameraSizingSystem);
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
        expect([size.x, size.y]).toEqual([80, 24]);
    });

    test("screenSizeFor divides by a 1:2 screen unit", () => {
        expect(PixelCameraSizingSystem.screenSizeFor({widthPx: 100, heightPx: 50}, 10)).toEqual({x: 10, y: 2.5});
    });
});

describe("PixelRenderSettings", () => {
    test("rounds the screen unit down to whole pixels, at least one", () => {
        const settings = new PixelRenderSettings();
        expect(settings.wholePixelsPerScreenUnitX()).toBe(PixelRenderSettings.DEFAULT_PIXELS_PER_SCREEN_UNIT_X);
        settings.pixelsPerScreenUnitX = 0.5;
        expect(settings.wholePixelsPerScreenUnitX()).toBe(1);
        settings.pixelsPerScreenUnitX = Number.NaN;
        expect(settings.wholePixelsPerScreenUnitX()).toBe(1);
        settings.pixelsPerScreenUnitX = 5.9;
        expect(settings.wholePixelsPerScreenUnitX()).toBe(5);
    });
});
