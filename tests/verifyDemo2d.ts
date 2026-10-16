/**
 * Runs the shared 2D demo (demo/2d/game.ts) on a MemoryPlatform, the way the terminal and the
 * browser host both do, and checks that it renders and survives its own input without errors:
 * proof the game module touches its host only through the world's platform. The output also
 * goes through a model of xterm.js (no tty line discipline), which must show every frame cell
 * painted on start and after a resize.
 *
 * Run: bun tests/verifyDemo2d.ts
 */
import {DebugWorld} from "../src/js_engine/core";
import {MemoryPlatform} from "../src/js_engine/platform";
import {consoleInput} from "../src/js_engine/input";
import {consoleOverride} from "../src/js_engine/debugging";
import {originalConsole} from "../src/js_engine/debugging/originalConsole";
import {Ansi} from "../src/js_engine/rendering/console";
import {TerminalScreen} from "../src/js_engine/testing/terminalScreen";
import {setupDemo2d} from "../demo/2d/game";

const FRAMES = 60;
const FRAME_MS = 1000 / 60;
const ARROW_UP = "\x1b[A";
const CTRL_C = "\x03";
const START = {columns: 120, rows: 40};
const RESIZED = {columns: 160, rows: 50};
const START_CHECK_FRAME = 4;
const SPACE_FRAME = 10;
const RESIZE_FRAME = 30;

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

const platform = new MemoryPlatform(START);
const terminal = new TerminalScreen(START.columns, START.rows);
const world = new DebugWorld({platform});
let quits = 0;
setupDemo2d(world, {quit: () => quits++});

const tick = () => {
    const before = platform.output.length;
    world.time.deltaTime = FRAME_MS;
    (world as any).update();
    terminal.write(platform.output.text().slice(before));
};

/** The frame is one row short of the terminal: the last row is left for the prompt. */
function expectFramePainted(size: {columns: number, rows: number}, when: string) {
    const cells = size.columns * (size.rows - 1);
    const written = terminal.writtenCells(size.columns, size.rows - 1);
    expect(written === cells, `every frame cell painted ${when} (${written}/${cells})`);
}

expect(platform.input.started, "the game enabled input on the world's platform");

let framesWritten = 0;
let entitiesBeforeSpace = 0;
for (let frame = 0; frame < FRAMES; frame++) {
    if (frame === SPACE_FRAME) {
        entitiesBeforeSpace = world.entityCount;
        platform.input.feed(" ");
    }
    if (frame % 4 === 0) platform.input.feed(ARROW_UP);
    if (frame === RESIZE_FRAME) {
        platform.screen.resize(RESIZED.columns, RESIZED.rows);
        terminal.resize(RESIZED.columns, RESIZED.rows);
    }
    const before = platform.output.length;
    tick();
    if (platform.output.length > before) framesWritten++;
    if (frame === START_CHECK_FRAME) {
        expectFramePainted(START, "on start");
        const crossCells = terminal.count("▀");
        expect(crossCells >= 10, `the crosses are visible on start (${crossCells} half-block cells)`);
    }
    if (frame === RESIZE_FRAME) expectFramePainted(RESIZED, "after a resize");
}

const screen = Ansi.strip(platform.output.text());
expect(framesWritten > FRAMES / 2, `frames written (${framesWritten}/${FRAMES})`);
expect(screen.includes("FPS:"), "the FPS label rendered");
expect(screen.includes("Entities:"), "the entity counter rendered");
expect(world.entityCount === entitiesBeforeSpace + 1000, `Space spawned 1000 pixels (${entitiesBeforeSpace} -> ${world.entityCount})`);
expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

platform.input.feed(CTRL_C);
expect(quits === 1, "Ctrl+C stopped the world and asked the host to quit");

consoleInput.disable();
consoleOverride.removeConsoleEventListener(errorRecorder);

if (failures > 0) {
    console.error(`${failures} demo smoke-test failures`);
    process.exit(1);
}
log("2D demo smoke test OK");
