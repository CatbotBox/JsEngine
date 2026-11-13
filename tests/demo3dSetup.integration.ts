import {readFileSync} from "fs";
import {join, resolve} from "path";
import {DebugWorld, EntityQuery} from "../src/engine/core";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {PreloadedFileSource} from "../src/hosts/web";
import type {FileSource, FileStat} from "../src/engine/platform";
import type {FetchedFile} from "../src/hosts/web";
import {Input} from "../src/engine/input";
import {TerminalInput} from "../src/hosts/terminal";
import {Camera} from "../src/engine/rendering";
import {FieldOfView} from "../src/engine/rendering/3d";
import {LocalRotation} from "../src/engine/translation";
import {Vec} from "../src/engine/math/types/vec";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {Ansi, CellSurfaceResource} from "../src/backends/cells";
import {MeshCellPassSystem} from "../src/backends/cells/3d";
import {inflate, meshCachePathFor} from "../src/engine/rendering/3d";
import {normalizePath} from "../src/engine/platform";
import {TerminalScreen} from "./support/terminalScreen";
import {setupDemo3d} from "../demo/3d/game";
import {buildDemo3dManifest} from "../demo/3d/assets";
import {nodePlatform} from "../src/hosts/terminal";

const ROOT = resolve(__dirname, "..");
const FRAMES = 30;
const FRAME_MS = 1000 / 60;
const CTRL_C = "\x03";
const ARROW_RIGHT = "\x1b[C";
const LEFT_DRAG_10_CELLS_RIGHT = "\x1b[<0;10;10M\x1b[<32;20;10M\x1b[<0;20;10m";
const WHEEL_UP = "\x1b[<64;20;10M";
const FOV_WHEEL_STEP = 1.05;
const FOV_TOLERANCE_DEG = 1e-4;
const SIZE = {columns: 120, rows: 40};
const FIRST_SPAWN_FRAME = 5;
const SPAWN_EVERY = 4;
const KEY_RELEASE_WAIT_MS = 150;
const BYTES_PER_MB = 1024 * 1024;
const PROMPT_ROWS = 1;
const MIN_SCENE_CELL_DIVISOR = 50;

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

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

async function fetchFromDisk(url: string): Promise<FetchedFile> {
    let bytes: Uint8Array;
    try {
        bytes = new Uint8Array(readFileSync(join(ROOT, decodeURI(url))));
    } catch {
        return {ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0)};
    }
    return {ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer};
}

class WatchedFiles implements FileSource {
    public readonly read = new Set<string>();

    public constructor(private readonly files: PreloadedFileSource) {
    }

    public readBytes(path: string): Uint8Array {
        this.read.add(normalizePath(path));
        return this.files.readBytes(path);
    }

    public readText(path: string): string {
        this.read.add(normalizePath(path));
        return this.files.readText(path);
    }

    public exists(path: string): boolean {
        return this.files.exists(path);
    }

    public stat(path: string): FileStat {
        return this.files.stat(path);
    }
}

let sharedBuffersAllocated = 0;
const RealSharedArrayBuffer = globalThis.SharedArrayBuffer;
(globalThis as {SharedArrayBuffer: unknown}).SharedArrayBuffer = new Proxy(RealSharedArrayBuffer, {
    construct(target, args) {
        sharedBuffersAllocated++;
        return Reflect.construct(target, args);
    },
});

async function main(): Promise<void> {
    const errors: string[] = [];
    const errorRecorder: Console = Object.create(originalConsole);
    errorRecorder.error = (...data: unknown[]) => errors.push(data.map(String).join(" "));
    consoleOverride.addConsoleEventListener(errorRecorder);

    const manifest = buildDemo3dManifest(ROOT, nodePlatform());
    const preloaded = new PreloadedFileSource({fetch: fetchFromDisk});
    await preloaded.preload(manifest.files);
    await preloaded.ensureLoaded(manifest.files.map(file => file.path));
    const files = new WatchedFiles(preloaded);
    let inflateCalls = 0;
    const platform = new MemoryPlatform({
        fileSource: files,
        inflate: bytes => {
            inflateCalls++;
            return inflate(bytes);
        },
    });

    const statOnly = manifest.files.filter(file => file.statOnly === true).map(file => file.path);
    const cached = manifest.models.filter(model => manifest.files.some(file => file.path === meshCachePathFor(model.path)));
    const fetchedBytes = manifest.files.reduce((sum, file) => sum + (file.statOnly === true ? 0 : file.size), 0);
    const lazy = manifest.files.filter(file => file.lazy === true).map(file => file.path);
    log(`manifest: ${manifest.models.length} models, ${manifest.files.length} files, ${(fetchedBytes / BYTES_PER_MB).toFixed(1)} MB preloaded, stat-only: ${statOnly.join(", ")}, lazy: ${lazy.join(", ") || "none"}`);

    const terminal = new TerminalScreen(SIZE.columns, SIZE.rows);
    const gameTerminal = new MemoryTerminal(SIZE);
    const world = new DebugWorld({platform});
    world.resources.insert(new CellSurfaceResource(gameTerminal));
    const terminalInput = new TerminalInput({
        terminal: gameTerminal,
        platform,
        sink: world.resources.getOrCreate(Input),
        mouse: true,
        hideCursor: true,
    }).start();
    let quits = 0;
    const loadStart = performance.now();
    setupDemo3d(world, {listModels: () => manifest.models, quit: () => quits++});
    log(`models loaded in ${(performance.now() - loadStart).toFixed(0)} ms`);

    expect(gameTerminal.started && gameTerminal.text().includes("\x1b[?1003h\x1b[?1006h\x1b[?25l"), "the launch wiring started terminal input with the mouse on and the cursor hidden");
    expect(platform.workers === undefined, "the platform offers no workers, as in the browser");

    const pass = world.tryGetSystem(MeshCellPassSystem);
    let framesWritten = 0;
    let maxTriangles = 0;
    let maxSceneCells = 0;
    let spawned = 0;
    for (let frame = 0; frame < FRAMES; frame++) {
        if (frame >= FIRST_SPAWN_FRAME && (frame - FIRST_SPAWN_FRAME) % SPAWN_EVERY === 0 && spawned < manifest.models.length - 1) {
            await sleep(KEY_RELEASE_WAIT_MS);
            gameTerminal.feed("n");
            gameTerminal.feed(" ");
            spawned++;
        }
        gameTerminal.feed(ARROW_RIGHT);
        const before = gameTerminal.length;
        world.time.deltaTime = FRAME_MS;
        (world as any).update();
        platform.advance(FRAME_MS);
        const written = gameTerminal.text().slice(before);
        terminal.write(written);
        if (written.length > 0) framesWritten++;
        maxTriangles = Math.max(maxTriangles, pass?.trianglesDrawn ?? 0);
        maxSceneCells = Math.max(maxSceneCells, terminal.truecolorCells());
    }

    const screen = Ansi.strip(gameTerminal.text());
    const frameCells = SIZE.columns * (SIZE.rows - PROMPT_ROWS);
    expect(framesWritten > FRAMES / 2, `frames written (${framesWritten}/${FRAMES})`);
    expect(maxTriangles > 0, `the 3D pass drew triangles (up to ${maxTriangles} in one frame)`);
    expect(maxSceneCells > frameCells / MIN_SCENE_CELL_DIVISOR, `scene cells painted in 24-bit colour (up to ${maxSceneCells}/${frameCells})`);
    expect(screen.includes("FPS:"), "the FPS label rendered");
    expect(screen.includes("Next: "), "the spawn preview rendered");
    expect(world.entityCount > 0 && spawned === manifest.models.length - 1, `every model was spawned once (${spawned + 1} models)`);
    expect(cached.length > 0, `models with a mesh cache: ${cached.map(model => model.name).join(", ")}`);
    for (const model of cached) {
        const objPath = normalizePath(model.path);
        const hit = files.read.has(meshCachePathFor(objPath)) && !files.read.has(objPath);
        expect(hit, `${model.name} loaded from its mesh cache, its obj never read`);
    }
    const pngs = manifest.files.filter(file => file.path.toLowerCase().endsWith(".png"));
    expect(pngs.length === 0 || inflateCalls >= pngs.length, `PNG textures inflated by the hand-written inflate (${inflateCalls} call(s), ${pngs.length} PNG(s))`);
    expect(sharedBuffersAllocated === 0, `no SharedArrayBuffer allocated: the raster stayed single-threaded (${sharedBuffersAllocated})`);
    expect(errors.length === 0, `no errors logged${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

    const cameraQuery = new EntityQuery(world, [Camera, FieldOfView, LocalRotation]);
    const cameraView = () => {
        const {fov, rotation} = cameraQuery.getSingleton({fov: FieldOfView, rotation: LocalRotation});
        return {degrees: fov.degrees, yaw: Vec.y(rotation.xyzw)};
    };
    const beforeLook = cameraView();
    gameTerminal.feed(LEFT_DRAG_10_CELLS_RIGHT + WHEEL_UP);
    (world as any).update();
    const afterLook = cameraView();
    expect(afterLook.yaw !== beforeLook.yaw, `a left drag turned the camera (yaw quaternion ${beforeLook.yaw.toFixed(3)} -> ${afterLook.yaw.toFixed(3)})`);
    expect(Math.abs(afterLook.degrees - beforeLook.degrees / FOV_WHEEL_STEP) < FOV_TOLERANCE_DEG, `the wheel zoomed in one step (${beforeLook.degrees.toFixed(2)} -> ${afterLook.degrees.toFixed(2)} degrees)`);

    gameTerminal.feed(CTRL_C);
    expect(quits === 0, "Ctrl+C waits for the next frame's input");
    (world as any).update();
    expect(quits === 1, "Ctrl+C stopped the world and asked the host to quit");
    expect(errors.length === 0, `no errors logged while quitting${errors.length > 0 ? ": " + errors.join(" | ") : ""}`);

    terminalInput.stop();
    expect(!gameTerminal.started && gameTerminal.text().endsWith("\x1b[?1003l\x1b[?1006l\x1b[?25h"), "stopping terminal input restored the mouse mode and the cursor");
    consoleOverride.removeConsoleEventListener(errorRecorder);
    (globalThis as {SharedArrayBuffer: unknown}).SharedArrayBuffer = RealSharedArrayBuffer;

    if (failures > 0) {
        console.error(`${failures} 3D demo smoke-test failures`);
        process.exit(1);
    }
    log("3D demo smoke test OK");
}

void main();
