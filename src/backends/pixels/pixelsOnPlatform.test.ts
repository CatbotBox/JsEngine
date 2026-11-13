import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import {RootSystemGroup} from "../../engine/core/rootSystemGroup";
import {System} from "../../engine/core/system";
import {Camera} from "../../engine/rendering/camera";
import {ScreenSize} from "../../engine/rendering/screenSize";
import {RenderingSystemGroup} from "../../engine/rendering/renderingSystemGroup";
import {DEFAULT_TEXT_FOREGROUND_RGB} from "../../engine/rendering/textColorPalette";
import {MemoryPixelPresenter} from "./memoryPixelPresenter";
import {PixelPresenterResource} from "./pixelPresenterResource";
import {PixelRenderSystemGroup} from "./pixelRenderSystemGroup";
import {PixelCameraSizingSystem} from "./pixelCameraSizingSystem";
import {PixelRenderSettings} from "./pixelRenderSettings";
import {RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";

const BACKGROUND_RGB = 0x203040;
const RED_SHIFT = 16, GREEN_SHIFT = 8;

class PixelPassProbeSystem extends System {
    public frames = 0;

    override systemGroup() {
        return PixelRenderSystemGroup;
    }

    onUpdate() {
        this.frames++;
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
