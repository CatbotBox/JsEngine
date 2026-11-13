import {DebugWorld} from "../src/engine/core";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {Input, Key, NO_MODIFIERS} from "../src/engine/input";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {GREEN_SHIFT, RED_SHIFT} from "../src/engine/rendering";
import {RenderMesh} from "../src/engine/rendering/3d/renderMesh";
import {
    ComponentSchemaRegistry,
    deserializeInto,
    parseSceneDocument,
    platformSceneAssetLoader,
    registerEngineComponentSchemas,
    serializeWorld,
} from "../src/engine/scene";
import type {SceneDocument, SerializedScene} from "../src/engine/scene";
import {CellPresenterResource, HudTextSpriteCellPassSystem, registerCellsComponentSchemas} from "../src/backends/cells";
import {HudSpriteCellPassSystem, SpriteCellPassSystem} from "../src/backends/cells/2d";
import {
    HudTextSpritePixelPassSystem,
    MemoryPixelPresenter,
    PixelPresenterResource,
    RGBA_BYTES_PER_PIXEL,
    registerPixelsComponentSchemas,
} from "../src/backends/pixels";
import type {PixelFrame, PixelPresenterSize} from "../src/backends/pixels";
import {MeshPixelPassSystem} from "../src/backends/pixels/3d";
import {Ansi, AnsiCellPresenter, nodePlatform} from "../src/hosts/terminal";
import {TerminalScreen} from "./support/terminalScreen";
import {setupDemo2d} from "../demo/2d/game";
import {installCellRendering2d} from "../demo/2d/launch/cellRendering";
import {setupDemo3d} from "../demo/3d/game";
import type {DemoModel} from "../demo/3d/game";
import {installPixelRendering3d} from "../demo/3d/launch/pixelRendering";

const FRAME_MS = 1000 / 60;
const SETTLE_FRAMES = 6;
const SPAWN_SETTLE_FRAMES = 3;
const CELLS = {columns: 120, rows: 40};
const PROMPT_ROWS = 1;
const MIN_CROSS_CELLS = 10;
const PIXELS: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const BACKGROUND_RGB = 0x000000;
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

function sameDocument(a: SceneDocument, b: SceneDocument): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function describeSkipped(saved: SerializedScene): string {
    return saved.report.skippedComponentTypes.map(skipped => `${skipped.typeName} x${skipped.entityCount}`).join(", ") || "none";
}

function keyDown(world: DebugWorld, key: Key): void {
    world.resources.getOrCreate(Input).enqueue({type: "keyDown", key, repeat: false, ...NO_MODIFIERS});
}

function stepFrames(world: DebugWorld, frames: number, afterEach: () => void = () => undefined): void {
    for (let frame = 0; frame < frames; frame++) {
        world.step(FRAME_MS);
        afterEach();
    }
}

function nonBackgroundPixels(frame: PixelFrame): number {
    let count = 0;
    for (let i = 0; i < frame.rgba.length; i += RGBA_BYTES_PER_PIXEL) {
        const rgb = (frame.rgba[i] << RED_SHIFT) | (frame.rgba[i + 1] << GREEN_SHIFT) | frame.rgba[i + 2];
        if (rgb !== BACKGROUND_RGB) count++;
    }
    return count;
}

function runDemo2dOnCells(): void {
    log("--- 2D demo on cells");
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerCellsComponentSchemas(registry);
    const platform = new MemoryPlatform();

    const playing = new DebugWorld({platform});
    playing.resources.insert(new CellPresenterResource(new AnsiCellPresenter(new MemoryTerminal(CELLS))));
    setupDemo2d(playing, {render: installCellRendering2d(playing), quit: () => undefined});
    stepFrames(playing, SETTLE_FRAMES);
    keyDown(playing, Key.Space);
    stepFrames(playing, SPAWN_SETTLE_FRAMES);

    const saved = serializeWorld(playing, registry);
    log(`saved ${saved.document.entities.length} entities; skipped types: ${describeSkipped(saved)}`);
    expect(saved.report.unsavedAssets.length === 0, "the 2D scene has no unsaved assets");
    expect(saved.report.danglingEntityRefs.length === 0, "the 2D scene has no dangling entity references");
    expect(saved.document.entities.some(record => record.components.TextSpriteCellPassSettings !== undefined), "the cells settings entity was saved");

    const output = new MemoryTerminal(CELLS);
    const screen = new TerminalScreen(CELLS.columns, CELLS.rows);
    const loaded = new DebugWorld({platform});
    loaded.resources.insert(new CellPresenterResource(new AnsiCellPresenter(output)));
    loaded.ensureSystemExists(SpriteCellPassSystem);
    loaded.ensureSystemExists(HudSpriteCellPassSystem);
    loaded.ensureSystemExists(HudTextSpriteCellPassSystem);
    const result = deserializeInto(loaded, registry, parseSceneDocument(JSON.stringify(saved.document)), {assets: platformSceneAssetLoader(platform)});
    expect(result.report.droppedComponents.length === 0 && result.report.danglingEntityRefs.length === 0, "loading reported nothing dropped or dangling");
    expect(sameDocument(serializeWorld(loaded, registry).document, saved.document), "the loaded world serializes to the same document");

    let written = 0;
    stepFrames(loaded, SETTLE_FRAMES, () => {
        screen.write(output.text().slice(written));
        written = output.length;
    });
    const cells = CELLS.columns * (CELLS.rows - PROMPT_ROWS);
    const painted = screen.writtenCells(CELLS.columns, CELLS.rows - PROMPT_ROWS);
    expect(painted === cells, `every frame cell painted after loading (${painted}/${cells})`);
    const crossCells = screen.count("▀");
    expect(crossCells >= MIN_CROSS_CELLS, `the crosses are visible after loading (${crossCells} half-block cells)`);
    const text = Ansi.strip(output.text());
    expect(text.includes("FPS:") && text.includes("Entities:"), "the saved HUD labels rendered");
    expect(sameDocument(serializeWorld(loaded, registry).document, saved.document), "ticking the loaded world changed no saved data");
}

function runDemo3dOnPixels(): void {
    log("--- 3D demo on pixels");
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerPixelsComponentSchemas(registry);
    const host = nodePlatform();
    const platform = new MemoryPlatform({fileSource: host.files, inflate: host.inflate});

    const playing = new DebugWorld({platform});
    playing.resources.insert(new PixelPresenterResource(new MemoryPixelPresenter(PIXELS)));
    setupDemo3d(playing, {render: installPixelRendering3d(playing), listModels: () => MODELS, quit: () => undefined});
    stepFrames(playing, SETTLE_FRAMES);
    keyDown(playing, Key.Space);
    stepFrames(playing, SPAWN_SETTLE_FRAMES);
    keyDown(playing, Key.N);
    stepFrames(playing, 1);
    keyDown(playing, Key.Space);
    stepFrames(playing, SPAWN_SETTLE_FRAMES);

    const saved = serializeWorld(playing, registry);
    const meshRecords = saved.document.entities.filter(record => record.components.RenderMesh !== undefined);
    log(`saved ${saved.document.entities.length} entities (${meshRecords.length} meshes); skipped types: ${describeSkipped(saved)}`);
    expect(meshRecords.length === 2, "both spawned models were saved");
    expect(meshRecords.every(record => JSON.stringify(record.components.RenderMesh.mesh).includes(".obj")), "meshes were saved by path");
    expect(saved.report.unsavedAssets.length === 0, "the 3D scene has no unsaved assets");

    const presenter = new MemoryPixelPresenter(PIXELS);
    const loaded = new DebugWorld({platform});
    loaded.resources.insert(new PixelPresenterResource(presenter));
    loaded.ensureSystemExists(MeshPixelPassSystem);
    loaded.ensureSystemExists(HudTextSpritePixelPassSystem);
    const result = deserializeInto(loaded, registry, parseSceneDocument(JSON.stringify(saved.document)), {assets: platformSceneAssetLoader(platform)});
    expect(result.report.droppedComponents.length === 0 && result.report.danglingEntityRefs.length === 0, "loading reported nothing dropped or dangling");
    expect(sameDocument(serializeWorld(loaded, registry).document, saved.document), "the loaded world serializes to the same document");
    const loadedMeshes = result.entities.filter(entity => loaded.entityManager.hasComponent(entity, RenderMesh));
    expect(loadedMeshes.length === 2, "both meshes were loaded");

    const pass = loaded.tryGetSystem(MeshPixelPassSystem);
    let maxTriangles = 0;
    stepFrames(loaded, SETTLE_FRAMES, () => {
        platform.advance(FRAME_MS);
        maxTriangles = Math.max(maxTriangles, pass?.trianglesDrawn ?? 0);
    });
    const frame = presenter.lastFrame;
    expect(frame !== undefined, "the loaded world presented a pixel frame");
    if (frame !== undefined) {
        const scenePixels = nonBackgroundPixels(frame);
        const framePixels = PIXELS.widthPx * PIXELS.heightPx;
        expect(scenePixels > framePixels / MIN_SCENE_PIXEL_DIVISOR, `the loaded scene painted pixels (${scenePixels}/${framePixels})`);
    }
    expect(maxTriangles > 0, `the loaded meshes drew triangles (up to ${maxTriangles} in one frame)`);
    expect(sameDocument(serializeWorld(loaded, registry).document, saved.document), "ticking the loaded world changed no saved data");
}

runDemo2dOnCells();
runDemo3dOnPixels();
expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);
consoleOverride.removeConsoleEventListener(errorRecorder);

if (failures > 0) {
    console.error(`${failures} scene round-trip failures`);
    process.exit(1);
}
log("scene round trip OK");
