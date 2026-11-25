import {describe, expect, test} from "../../engine/testing/harness";
import {MemoryPlatform} from "../../engine/testing/memoryPlatform";
import {World} from "../../engine/core/world";
import type {Entity, EntityManager} from "../../engine/core";
import {Input} from "../../engine/input/input";
import {NO_MODIFIERS} from "../../engine/input/inputEvent";
import {Camera} from "../../engine/rendering/camera";
import {TextColor} from "../../engine/rendering/textColor";
import {resolveTextColorRgb} from "../../engine/rendering/textColorPalette";
import {Children} from "../../engine/translation/children";
import {Parent} from "../../engine/translation/parent";
import {UiBox} from "../../engine/ui/uiBox";
import {UiLayout} from "../../engine/ui/uiLayout";
import {UiOffset} from "../../engine/ui/uiOffset";
import {UiRoot} from "../../engine/ui/uiRoot";
import {UiSize} from "../../engine/ui/uiSize";
import {UiState} from "../../engine/ui/uiState";
import {MemoryPixelPresenter} from "./memoryPixelPresenter";
import {RGBA_BYTES_PER_PIXEL} from "./pixelFrame";
import type {PixelFrame} from "./pixelFrame";
import {installPixelsBackend} from "./pixelsBackend";
import {PIXELS_UI_PASSES} from "./pixelsUiPasses";

const SIZE = {widthPx: 240, heightPx: 160};
const PIXELS_PER_SCREEN_UNIT_X = 8, PIXELS_PER_SCREEN_UNIT_Y = 16;
const SCALE = 1.5;
const SETTLE_STEPS = 3;
const PROBE_STEP_PX = 0.5;
const PROBE_FROM_PX = 8, PROBE_TO_PX = 64;
const PROBE_ACROSS_PX = 30;
const RED_SHIFT = 16, GREEN_SHIFT = 8;
const RED_RGB = resolveTextColorRgb(TextColor.RED, 0);

interface Placement {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

type ProbeAxis = "x" | "y";

interface Probe {
    readonly axis: ProbeAxis;
    readonly xPx: number;
    readonly yPx: number;
    readonly hovered: boolean;
    readonly drawn: boolean;
}

function rgbAt(frame: PixelFrame, x: number, y: number): number {
    const i = (y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

function placed({x, y, width, height}: Placement): [UiOffset, UiSize] {
    const offset = new UiOffset();
    offset.x = x;
    offset.y = y;
    const size = new UiSize();
    size.widthMode = "fixed";
    size.width = width;
    size.heightMode = "fixed";
    size.height = height;
    return [offset, size];
}

function redBox(): UiBox {
    const box = new UiBox();
    box.background = TextColor.RED;
    return box;
}

function attach(entityManager: EntityManager, parent: Entity, children: readonly Entity[]): void {
    entityManager.addComponent(parent, new Children(...children));
    for (const child of children) entityManager.addComponent(child, new Parent(parent));
}

function probeAgreement(build: (entityManager: EntityManager, root: Entity) => Entity): Probe[] {
    const presenter = new MemoryPixelPresenter(SIZE);
    const world = new World({platform: new MemoryPlatform()});
    installPixelsBackend(world, presenter, PIXELS_UI_PASSES);
    const entityManager = world.entityManager;
    entityManager.createEntity("camera", [new Camera()]);
    const uiRoot = new UiRoot();
    uiRoot.scale = SCALE;
    const root = entityManager.createEntity("root", [uiRoot, new UiLayout()]);
    const target = build(entityManager, root);
    for (let step = 0; step < SETTLE_STEPS; step++) world.step();
    const input = world.resources.getOrCreate(Input);
    const probes: Probe[] = [];
    const probe = (axis: ProbeAxis, xPx: number, yPx: number): void => {
        input.enqueue({type: "pointerMove", x: xPx / PIXELS_PER_SCREEN_UNIT_X, y: yPx / PIXELS_PER_SCREEN_UNIT_Y, ...NO_MODIFIERS});
        world.step();
        const hovered = entityManager.getComponent<UiState>(target, UiState)!.hovered;
        probes.push({axis, xPx, yPx, hovered, drawn: rgbAt(presenter.lastFrame!, Math.floor(xPx), Math.floor(yPx)) === RED_RGB});
    };
    for (let px = PROBE_FROM_PX; px <= PROBE_TO_PX; px += PROBE_STEP_PX) {
        probe("x", px, PROBE_ACROSS_PX);
        probe("y", PROBE_ACROSS_PX, px);
    }
    return probes;
}

function pixelEdgesFrom(firstPx: number, endPx: number): number[] {
    const positions: number[] = [];
    for (let px = firstPx; px < endPx; px += PROBE_STEP_PX) positions.push(px);
    return positions;
}

function disagreements(probes: readonly Probe[]): Probe[] {
    return probes.filter(probe => probe.hovered !== probe.drawn);
}

describe("UI pointer hits on the pixels backend", () => {
    test("a box at fractional units is hit exactly on the pixels it fills, an exact edge belonging to the pixel after it", () => {
        const probes = probeAgreement((entityManager, root) => {
            const box = entityManager.createEntity("box", [...placed({x: 1.3, y: 0.7, width: 2.4, height: 1.6}), redBox()]);
            attach(entityManager, root, [box]);
            return box;
        });
        expect(disagreements(probes)).toEqual([]);
        expect(probes.some(probe => probe.hovered) && probes.some(probe => !probe.hovered)).toBe(true);
        expect(probes.filter(probe => probe.axis === "x" && probe.hovered).map(probe => probe.xPx)).toEqual(pixelEdgesFrom(16, 44));
    });

    test("a fractional clip rect is hit exactly where it lets the box's pixels through", () => {
        const probes = probeAgreement((entityManager, root) => {
            const layout = new UiLayout();
            layout.clip = true;
            const clipper = entityManager.createEntity("clipper", [...placed({x: 1.1, y: 0.9, width: 1.7, height: 1.2}), layout]);
            const box = entityManager.createEntity("box", [...placed({x: -1, y: -1, width: 6, height: 6}), redBox()]);
            attach(entityManager, root, [clipper]);
            attach(entityManager, clipper, [box]);
            return box;
        });
        expect(disagreements(probes)).toEqual([]);
        expect(probes.some(probe => probe.hovered) && probes.some(probe => !probe.hovered)).toBe(true);
    });
});
