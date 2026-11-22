import {existsSync, readdirSync} from "fs";
import {join, resolve} from "path";
import {App, EntityQuery} from "../src/engine/core";
import {Input} from "../src/engine/input";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {LocalPosition} from "../src/engine/translation";
import {installCellsBackend} from "../src/backends/cells";
import {CELLS_WORLD_TEXT_PASSES} from "../src/backends/cells/2d";
import {Ansi, AnsiCellPresenter, nodePlatform} from "../src/hosts/terminal";
import {TerminalInput} from "../src/hosts/terminalInput";
import {PROJECT_MANIFEST_FILE} from "../src/engine/project/projectManifest";
import {Drift, startLibraryOnlyGame} from "../demo/libraryOnly/game";

const ROOT = resolve(__dirname, "..");
const EXAMPLE_DIRECTORY = "demo/libraryOnly";
const GENERATED_FILE_MARKER = ".generated.";
const TERMINAL_SIZE = {columns: 80, rows: 24};
const FRAMES = 30;
const MS_PER_SECOND = 1000;
const TICKS_PER_SECOND = 60;
const FRAME_MS = MS_PER_SECOND / TICKS_PER_SECOND;
const START_X = -10;
const DRIFT_UNITS_PER_SECOND = 6;
const POSITION_TOLERANCE = 1e-3;
const DRIFTER_GLYPHS = "<o>";
const QUIT_KEY = "q";

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string): void {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

function filesUnder(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesUnder(path) : [path];
    });
}

const errors: string[] = [];
const errorRecorder: Console = Object.create(originalConsole);
errorRecorder.error = (...data: unknown[]) => errors.push(data.map(String).join(" "));
consoleOverride.addConsoleEventListener(errorRecorder);

async function main(): Promise<void> {
    const exampleRoot = join(ROOT, EXAMPLE_DIRECTORY);
    expect(!existsSync(join(exampleRoot, PROJECT_MANIFEST_FILE)), `the example has no ${PROJECT_MANIFEST_FILE}`);
    const generated = filesUnder(exampleRoot).filter(file => file.includes(GENERATED_FILE_MARKER));
    expect(generated.length === 0, `the example has no generated files (${generated.join(", ")})`);

    const platform = new MemoryPlatform({fileSource: nodePlatform().files});
    const terminal = new MemoryTerminal(TERMINAL_SIZE);
    const world = new App({platform}).createDebugWorld();
    installCellsBackend(world, new AnsiCellPresenter(terminal), CELLS_WORLD_TEXT_PASSES);
    const terminalInput = new TerminalInput({terminal, platform, sink: world.resources.getOrCreate(Input), mouse: false}).start();
    await startLibraryOnlyGame(world, {directory: EXAMPLE_DIRECTORY});

    for (let frame = 0; frame < FRAMES; frame++) world.step(FRAME_MS);

    const drifter = new EntityQuery(world, [Drift, LocalPosition]).getSingleton({position: LocalPosition});
    const expectedX = START_X + DRIFT_UNITS_PER_SECOND * FRAMES * FRAME_MS / MS_PER_SECOND;
    expect(Math.abs(drifter.position.x - expectedX) < POSITION_TOLERANCE, `the scene's Drift component moved the drifter (x ${drifter.position.x}, expected ${expectedX})`);
    expect(Ansi.strip(terminal.text()).includes(DRIFTER_GLYPHS), "the drifter's text sprite rendered");
    expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

    terminal.feed(QUIT_KEY);
    world.step(FRAME_MS);
    expect(platform.quitCount === 1, "Q quit the platform");
    expect(world.systemCount === 0, "the quit stopped the world");

    terminalInput.stop();
    consoleOverride.removeConsoleEventListener(errorRecorder);

    if (failures > 0) {
        console.error(`${failures} library-only example failures`);
        process.exit(1);
    }
    log("library-only example OK");
}

void main();
