import {DebugWorld, EntityQuery} from "../src/engine/core";
import {MemoryPlatform} from "../src/engine/testing/memoryPlatform";
import {Input, Key, NO_MODIFIERS} from "../src/engine/input";
import type {Modifiers} from "../src/engine/input";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {
    ASCII_PIXEL_FONT,
    Camera,
    GREEN_SHIFT,
    isGlyphColumnLit,
    RED_SHIFT,
    resolveTextColorRgb,
    ScreenSize,
    TextColor,
} from "../src/engine/rendering";
import {isPixelFrame, MemoryPixelPresenter, PixelPresenterResource, RGBA_BYTES_PER_PIXEL} from "../src/backends/pixels";
import type {PixelFrame, PixelPresenterSize} from "../src/backends/pixels";
import {MeshPixelPassSystem} from "../src/backends/pixels/3d";
import {nodePlatform} from "../src/hosts/terminal";
import {setupDemo2d} from "../demo/2d/game";
import {setupDemo3d} from "../demo/3d/game";
import type {DemoModel} from "../demo/3d/game";
import {installPixelRendering2d} from "../demo/2d/launch/pixelRendering";
import {installPixelRendering3d} from "../demo/3d/launch/pixelRendering";

const FRAME_MS = 1000 / 60;
const START: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const RESIZED: PixelPresenterSize = {widthPx: 800, heightPx: 480};
const PIXELS_PER_SCREEN_UNIT_X = 8;
const PIXELS_PER_SCREEN_UNIT_Y = 16;
const BACKGROUND_RGB = 0x000000;
const HUD_CROSS_RGB = 0x00FFCC;
const HUD_GREEN_RGB = resolveTextColorRgb(TextColor.GREEN, BACKGROUND_RGB);
const HELP_CYAN_RGB = resolveTextColorRgb(TextColor.CYAN, BACKGROUND_RGB);
const PIXELS_PER_SPACE = 1000;
const SETTLE_FRAMES = 4;
const RESIZE_SETTLE_FRAMES = 2;
const CROSS_SIDE_SPRITE_PIXELS = 3;
const SPRITE_PIXEL_SIDE_PX = 8;
const CROSS_SIDE_PX = CROSS_SIDE_SPRITE_PIXELS * SPRITE_PIXEL_SIDE_PX;
const HALF = 0.5;
const PLAYER_STEP_PX = 8;
const SPAWN_SETTLE_FRAMES = 3;
const MIN_SCENE_PIXEL_DIVISOR = 50;
const MODELS: readonly DemoModel[] = [
    {name: "cube", path: "./demo/3d/cube.obj"},
    {name: "blender_monkey", path: "./demo/3d/blender_monkey.obj"},
];

function log(message: string) {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string) {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

const errors: string[] = [];
const errorRecorder: Console = Object.create(originalConsole);
errorRecorder.error = (...data: unknown[]) => errors.push(data.map(String).join(" "));
consoleOverride.addConsoleEventListener(errorRecorder);

function rgbAt(frame: PixelFrame, x: number, y: number): number {
    const i = (y * frame.widthPx + x) * RGBA_BYTES_PER_PIXEL;
    return (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
}

function glyphMatches(frame: PixelFrame, character: string, left: number, top: number, litRgb: number, unlitRgb: number | undefined): boolean {
    const codePoint = character.codePointAt(0)!;
    for (let row = 0; row < PIXELS_PER_SCREEN_UNIT_Y; row++) {
        const bits = ASCII_PIXEL_FONT.glyphRowBits(codePoint, row);
        for (let column = 0; column < PIXELS_PER_SCREEN_UNIT_X; column++) {
            const rgb = rgbAt(frame, left + column, top + row);
            if (isGlyphColumnLit(bits, column) ? rgb !== litRgb : unlitRgb !== undefined && rgb !== unlitRgb) return false;
        }
    }
    return true;
}

function nonBackgroundPixels(frame: PixelFrame): number {
    let count = 0;
    for (let y = 0; y < frame.heightPx; y++) {
        for (let x = 0; x < frame.widthPx; x++) if (rgbAt(frame, x, y) !== BACKGROUND_RGB) count++;
    }
    return count;
}

function keyDown(input: Input, key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
    input.enqueue({type: "keyDown", key, repeat: false, ...modifiers});
}

function cameraScreenSize(world: DebugWorld): {x: number, y: number} {
    const {screenSize} = new EntityQuery(world, [Camera, ScreenSize]).getSingleton({screenSize: ScreenSize});
    return {x: screenSize.x, y: screenSize.y};
}

function expectFrameShape(presenter: MemoryPixelPresenter, world: DebugWorld, size: PixelPresenterSize, when: string): PixelFrame {
    const frame = presenter.lastFrame!;
    expect(frame !== undefined && isPixelFrame(frame), `a valid pixel frame was presented ${when}`);
    expect(frame.widthPx === size.widthPx && frame.heightPx === size.heightPx, `the frame is ${size.widthPx}x${size.heightPx} px ${when} (${frame.widthPx}x${frame.heightPx})`);
    expect(frame.pixelsPerScreenUnitX === PIXELS_PER_SCREEN_UNIT_X && frame.pixelsPerScreenUnitY === PIXELS_PER_SCREEN_UNIT_Y, `a screen unit is 8x16 px ${when}`);
    const screen = cameraScreenSize(world);
    const expectedX = size.widthPx / PIXELS_PER_SCREEN_UNIT_X, expectedY = size.heightPx / PIXELS_PER_SCREEN_UNIT_Y;
    expect(screen.x === expectedX && screen.y === expectedY, `the camera spans ${expectedX}x${expectedY} screen units ${when} (${screen.x}x${screen.y})`);
    return frame;
}

function runDemo2d(): void {
    log("--- 2D demo on pixels");
    const presenter = new MemoryPixelPresenter(START);
    const world = new DebugWorld({platform: new MemoryPlatform()});
    world.resources.insert(new PixelPresenterResource(presenter));
    const input = world.resources.getOrCreate(Input);
    let quits = 0;
    const render = installPixelRendering2d(world);
    expect(render.toggleHalfBlockCells === undefined, "the pixel render controls have no half-block toggle");
    setupDemo2d(world, {render, quit: () => quits++});

    const tick = () => {
        world.time.deltaTimeMs = FRAME_MS;
        (world as any).update();
    };
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) tick();

    const started = expectFrameShape(presenter, world, START, "on start");
    const centerX = START.widthPx * HALF, centerY = START.heightPx * HALF;
    const crossLeft = centerX - CROSS_SIDE_PX * HALF, crossTop = centerY - CROSS_SIDE_PX * HALF;
    const playerRgb = rgbAt(started, centerX, centerY);
    expect(playerRgb !== BACKGROUND_RGB, `the player cross's centre is painted at the screen centre (#${playerRgb.toString(16)})`);
    expect(rgbAt(started, crossLeft, crossTop) === BACKGROUND_RGB, "the player cross's transparent corner shows the background");
    expect(glyphMatches(started, "E", 0, START.heightPx - PIXELS_PER_SCREEN_UNIT_Y, HUD_GREEN_RGB, BACKGROUND_RGB), "the entity counter's E is drawn in the 8x16 font, bottom-left, in green");
    const hudCrossCenter = rgbAt(started, START.widthPx - CROSS_SIDE_PX * HALF, START.heightPx - CROSS_SIDE_PX * HALF);
    expect(hudCrossCenter === HUD_CROSS_RGB, `the HUD cross is anchored bottom-right (#${hudCrossCenter.toString(16)})`);

    keyDown(input, Key.Up);
    tick();
    const moved = presenter.lastFrame!;
    expect(rgbAt(moved, centerX, centerY - PLAYER_STEP_PX) === playerRgb && rgbAt(moved, centerX, centerY + PLAYER_STEP_PX - 1) !== playerRgb,
        "half a screen unit up moves the player cross 8 px");

    const entitiesBeforeSpace = world.enabledEntityCount;
    keyDown(input, Key.Space);
    for (let frame = 0; frame < SPAWN_SETTLE_FRAMES; frame++) tick();
    expect(world.enabledEntityCount === entitiesBeforeSpace + PIXELS_PER_SPACE, `Space spawned ${PIXELS_PER_SPACE} pixels (${entitiesBeforeSpace} -> ${world.enabledEntityCount})`);

    keyDown(input, Key.H);
    tick();
    expect(errors.length === 0, "the half-block key does nothing on pixels");

    presenter.resize(RESIZED.widthPx, RESIZED.heightPx);
    for (let frame = 0; frame < RESIZE_SETTLE_FRAMES; frame++) tick();
    const resized = expectFrameShape(presenter, world, RESIZED, "after a resize");
    const resizedHudCross = rgbAt(resized, RESIZED.widthPx - CROSS_SIDE_PX * HALF, RESIZED.heightPx - CROSS_SIDE_PX * HALF);
    expect(resizedHudCross === HUD_CROSS_RGB, "the HUD cross follows the resize to the new bottom-right");
    expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

    keyDown(input, Key.C, {...NO_MODIFIERS, ctrl: true});
    tick();
    expect(quits === 1, "Ctrl+C stopped the world and asked the host to quit");
}

function runDemo3d(): void {
    log("--- 3D demo on pixels");
    const host = nodePlatform();
    const platform = new MemoryPlatform({fileSource: host.files, inflate: host.inflate});
    const presenter = new MemoryPixelPresenter(START);
    const world = new DebugWorld({platform});
    world.resources.insert(new PixelPresenterResource(presenter));
    const input = world.resources.getOrCreate(Input);
    let quits = 0;
    const render = installPixelRendering3d(world);
    expect(render.toggleHalfBlockCells === undefined, "the pixel render controls have no half-block toggle");
    setupDemo3d(world, {render, listModels: () => MODELS, quit: () => quits++});

    const pass = world.tryGetSystem(MeshPixelPassSystem);
    let maxTriangles = 0;
    const tick = () => {
        world.time.deltaTimeMs = FRAME_MS;
        (world as any).update();
        platform.advance(FRAME_MS);
        maxTriangles = Math.max(maxTriangles, pass?.trianglesDrawn ?? 0);
    };
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) tick();
    keyDown(input, Key.N);
    keyDown(input, Key.Space);
    for (let frame = 0; frame < SPAWN_SETTLE_FRAMES; frame++) tick();

    const frame = expectFrameShape(presenter, world, START, "in 3D");
    const scenePixels = nonBackgroundPixels(frame);
    const framePixels = START.widthPx * START.heightPx;
    expect(maxTriangles > 0, `the mesh pass drew triangles (up to ${maxTriangles} in one frame)`);
    expect(scenePixels > framePixels / MIN_SCENE_PIXEL_DIVISOR, `the scene painted pixels (${scenePixels}/${framePixels})`);
    expect(glyphMatches(frame, "c", 0, 0, HELP_CYAN_RGB, undefined), "the controls help starts with a cyan 8x16 c at the top-left");
    expect(render.stats()?.rasterWorkers === 0, "the raster stayed single-threaded without platform workers");
    expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

    keyDown(input, Key.C, {...NO_MODIFIERS, ctrl: true});
    tick();
    expect(quits === 1, "Ctrl+C stopped the world and asked the host to quit");
}

runDemo2d();
runDemo3d();
consoleOverride.removeConsoleEventListener(errorRecorder);

if (failures > 0) {
    console.error(`${failures} pixel demo smoke-test failures`);
    process.exit(1);
}
log("pixel demo smoke test OK");
