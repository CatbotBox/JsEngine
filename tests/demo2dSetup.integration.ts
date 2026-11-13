import {DebugWorld} from "../src/engine/core";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {Input} from "../src/engine/input";
import {Ansi, AnsiCellPresenter, TerminalInput} from "../src/hosts/terminal";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {CellPresenterResource} from "../src/backends/cells";
import {TerminalScreen} from "./support/terminalScreen";
import {setupDemo2d} from "../demo/2d/game";
import {installCellRendering2d} from "../demo/2d/launch/cellRendering";

const FRAMES = 60;
const FRAME_MS = 1000 / 60;
const ARROW_UP = "\x1b[A";
const CTRL_C = "\x03";
const START = {columns: 120, rows: 40};
const RESIZED = {columns: 160, rows: 50};
const START_CHECK_FRAME = 4;
const SPACE_FRAME = 10;
const RESIZE_FRAME = 30;
const ARROW_EVERY_FRAMES = 4;
const MIN_CROSS_CELLS = 10;
const PIXELS_PER_SPACE = 1000;
const PROMPT_ROWS = 1;

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

const platform = new MemoryPlatform();
const gameTerminal = new MemoryTerminal(START);
const terminal = new TerminalScreen(START.columns, START.rows);
const world = new DebugWorld({platform});
world.resources.insert(new CellPresenterResource(new AnsiCellPresenter(gameTerminal)));
const terminalInput = new TerminalInput({
    terminal: gameTerminal,
    platform,
    sink: world.resources.getOrCreate(Input),
    mouse: true,
}).start();
let quits = 0;
setupDemo2d(world, {render: installCellRendering2d(world), quit: () => quits++});

const tick = () => {
    const before = gameTerminal.length;
    world.step(FRAME_MS);
    terminal.write(gameTerminal.text().slice(before));
};

function expectFramePainted(size: {columns: number, rows: number}, when: string) {
    const cells = size.columns * (size.rows - PROMPT_ROWS);
    const written = terminal.writtenCells(size.columns, size.rows - PROMPT_ROWS);
    expect(written === cells, `every frame cell painted ${when} (${written}/${cells})`);
}

expect(gameTerminal.started && gameTerminal.text().includes("\x1b[?1003h"), "the launch wiring started terminal input with the mouse on");

let framesWritten = 0;
let entitiesBeforeSpace = 0;
for (let frame = 0; frame < FRAMES; frame++) {
    if (frame === SPACE_FRAME) {
        entitiesBeforeSpace = world.enabledEntityCount;
        gameTerminal.feed(" ");
    }
    if (frame % ARROW_EVERY_FRAMES === 0) gameTerminal.feed(ARROW_UP);
    if (frame === RESIZE_FRAME) {
        gameTerminal.resize(RESIZED.columns, RESIZED.rows);
        terminal.resize(RESIZED.columns, RESIZED.rows);
    }
    const before = gameTerminal.length;
    tick();
    if (gameTerminal.length > before) framesWritten++;
    if (frame === START_CHECK_FRAME) {
        expectFramePainted(START, "on start");
        const crossCells = terminal.count("▀");
        expect(crossCells >= MIN_CROSS_CELLS, `the crosses are visible on start (${crossCells} half-block cells)`);
    }
    if (frame === RESIZE_FRAME) expectFramePainted(RESIZED, "after a resize");
}

const screen = Ansi.strip(gameTerminal.text());
expect(framesWritten > FRAMES / 2, `frames written (${framesWritten}/${FRAMES})`);
expect(screen.includes("FPS:"), "the FPS label rendered");
expect(screen.includes("Entities:"), "the entity counter rendered");
expect(world.enabledEntityCount === entitiesBeforeSpace + PIXELS_PER_SPACE, `Space spawned ${PIXELS_PER_SPACE} pixels (${entitiesBeforeSpace} -> ${world.enabledEntityCount})`);
expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

gameTerminal.feed(CTRL_C);
expect(quits === 0, "Ctrl+C waits for the next frame's input");
tick();
expect(quits === 1, "Ctrl+C stopped the world and asked the host to quit");
expect(errors.length === 0, `no errors logged while quitting${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);
const altScreenExits = gameTerminal.text().split(Ansi.modes.altScreenExit).length - 1;
expect(altScreenExits === 1, `stopping the world restored the presenter's screen once (${altScreenExits})`);

terminalInput.stop();
expect(!gameTerminal.started && gameTerminal.text().endsWith("\x1b[?1003l\x1b[?1006l"), "stopping terminal input restored the terminal");
consoleOverride.removeConsoleEventListener(errorRecorder);

if (failures > 0) {
    console.error(`${failures} demo smoke-test failures`);
    process.exit(1);
}
log("2D demo smoke test OK");
