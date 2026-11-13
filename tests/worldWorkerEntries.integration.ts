import {readFileSync} from "fs";
import {join, resolve} from "path";
import {connectWorldWorker, STOPPED_STATUS} from "../src/hosts/web";
import type {CellSurfaceSize, CellWorldDisplay, PixelSurfaceSize, PixelWorldDisplay, WorldWorker, WorldWorkerPage} from "../src/hosts/web";
import type {CellFrame} from "../src/backends/cells";
import type {PixelFrame, PixelPresenterSize} from "../src/backends/pixels";
import {Key, NO_MODIFIERS} from "../src/engine/input";
import type {Modifiers} from "../src/engine/input";
import {cellFrameLines, rgbCellCount} from "./support/cellFrameText";
import {pixelFrameShowsText, pixelRgbAt} from "./support/pixelFrameText";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest} from "../demo/3d/assets";
import {nodePlatform} from "../src/hosts/terminal";
import {BLACK_RGB} from "../src/engine/rendering";

const ROOT = resolve(__dirname, "..");
const SHIM = join(ROOT, "tests", "worldWorkerShim.ts");
const DEFAULT_DIST = "dist/web-prod";
const DIST_ARG = process.argv.indexOf("--dist");
const DIST = DIST_ARG < 0 ? undefined : resolve(process.argv[DIST_ARG + 1] ?? DEFAULT_DIST);
const CTRL: Modifiers = {...NO_MODIFIERS, ctrl: true};
const START = {columns: 120, rows: 40};
const RESIZED = {columns: 160, rows: 50};
const PIXELS_PER_SCREEN_UNIT_X = 8;
const PIXELS_PER_SCREEN_UNIT_Y = 16;
const PIXEL_START: PixelPresenterSize = {widthPx: START.columns * PIXELS_PER_SCREEN_UNIT_X, heightPx: START.rows * PIXELS_PER_SCREEN_UNIT_Y};
const PIXEL_RESIZED: PixelPresenterSize = {widthPx: RESIZED.columns * PIXELS_PER_SCREEN_UNIT_X, heightPx: RESIZED.rows * PIXELS_PER_SCREEN_UNIT_Y};
const RASTER_WORKERS = 3;
const TIMEOUT_MS = 20_000;
const LAZY_SPAWN_TIMEOUT_MS = 60_000;
const PRESS_INTERVAL_MS = 200;
const BYTES_PER_MB = 1024 * 1024;
const POLL_INTERVAL_MS = 10;
const FRAME_ARRIVAL_WINDOW_MS = 300;
const PROMPT_ROWS = 1;
const MIN_SCENE_CELL_DIVISOR = 50;
const SCENE_REGION_MARGIN_FRACTION = 0.25;
const ISOLATED = true;
const NOT_ISOLATED = false;
const SWARM_TITLE = "S W A R M";
const SWARM_HUD_WAVE = "WAVE";

interface QuitChord {
    readonly key: Key;
    readonly modifiers: Modifiers;
    readonly label: string;
}

const CTRL_C_QUIT: QuitChord = {key: Key.C, modifiers: CTRL, label: "Ctrl+C"};
const ESCAPE_QUIT: QuitChord = {key: Key.Escape, modifiers: NO_MODIFIERS, label: "Esc"};
const LINE_SEPARATOR = "\n";

const WORKER_SOURCES: Readonly<Record<string, string>> = {
    "world2d": join(ROOT, "demo", "2d", "launch", "web.worker.ts"),
    "world3d": join(ROOT, "demo", "3d", "launch", "web.worker.ts"),
    "world2d-pixels": join(ROOT, "demo", "2d", "launch", "pixelWeb.worker.ts"),
    "world3d-pixels": join(ROOT, "demo", "3d", "launch", "pixelWeb.worker.ts"),
    "worldswarm": join(ROOT, "demo", "swarm", "launch", "web.worker.ts"),
    "worldswarm-pixels": join(ROOT, "demo", "swarm", "launch", "pixelWeb.worker.ts"),
};

function workerEntry(name: string): string {
    return DIST === undefined ? WORKER_SOURCES[name] : join(DIST, `${name}.worker.js`);
}

function demo3dManifest(): Demo3dManifest {
    if (DIST === undefined) return buildDemo3dManifest(ROOT, nodePlatform());
    return JSON.parse(readFileSync(join(DIST, "3d-manifest.json"), "utf8")) as Demo3dManifest;
}

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

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function waitUntil(condition: () => boolean, timeoutMs: number = TIMEOUT_MS): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
        if (performance.now() > deadline) return false;
        await sleep(POLL_INTERVAL_MS);
    }
    return true;
}

abstract class RecordingDisplay {
    public readonly statuses: string[] = [];
    public readonly errors: string[] = [];
    public frames = 0;
    private readonly resizeListeners = new Set<() => void>();
    private readonly seenByPattern = new Map<string, boolean>();

    public onResize(listener: () => void): () => void {
        this.resizeListeners.add(listener);
        return () => {
            this.resizeListeners.delete(listener);
        };
    }

    public showStatus(text: string): void {
        this.statuses.push(text);
    }

    public showError(text: string): void {
        this.errors.push(text);
    }

    public watch(pattern: string): void {
        this.seenByPattern.set(pattern, this.showing(pattern));
    }

    public shown(pattern: string): boolean {
        return this.seenByPattern.get(pattern) === true;
    }

    public statusShown(pattern: string): boolean {
        return this.statuses.some(status => status.includes(pattern));
    }

    public abstract showing(pattern: string): boolean;

    public abstract framePainted(): boolean;

    public abstract scenePainted(): boolean;

    public abstract sizeLabel(): string;

    protected recordFrame(onPresented: () => void): void {
        this.frames++;
        for (const [pattern, seen] of this.seenByPattern) if (!seen && this.showing(pattern)) this.seenByPattern.set(pattern, true);
        setTimeout(onPresented, 0);
    }

    protected notifyResize(): void {
        for (const listener of [...this.resizeListeners]) listener();
    }
}

class CellFrameDisplay extends RecordingDisplay implements CellWorldDisplay {
    private latest: CellFrame | undefined;
    private latestText = "";

    public constructor(private columns: number, private rows: number) {
        super();
    }

    public surfaceSize(): CellSurfaceSize {
        return {kind: "cells", columns: this.columns, rows: this.rows};
    }

    public presentCells(frame: CellFrame, onPresented: () => void): void {
        this.latest = frame;
        this.latestText = cellFrameLines(frame).join(LINE_SEPARATOR);
        this.recordFrame(onPresented);
    }

    public resize(columns: number, rows: number): void {
        this.columns = columns;
        this.rows = rows;
        this.notifyResize();
    }

    public showing(pattern: string): boolean {
        return this.latestText.includes(pattern);
    }

    public framePainted(): boolean {
        return this.latest !== undefined && this.latest.width === this.columns && this.latest.height === this.rows - PROMPT_ROWS;
    }

    public scenePainted(): boolean {
        const frameCells = this.columns * (this.rows - PROMPT_ROWS);
        return this.latest !== undefined && rgbCellCount(this.latest) > frameCells / MIN_SCENE_CELL_DIVISOR;
    }

    public sizeLabel(): string {
        return `${this.columns}x${this.rows}`;
    }
}

class PixelFrameDisplay extends RecordingDisplay implements PixelWorldDisplay {
    private latest: PixelFrame | undefined;
    private size: PixelPresenterSize;

    public constructor(size: PixelPresenterSize) {
        super();
        this.size = size;
    }

    public surfaceSize(): PixelSurfaceSize {
        return {kind: "pixels", ...this.size};
    }

    public presentPixels(frame: PixelFrame, onPresented: () => void): void {
        this.latest = frame;
        this.recordFrame(onPresented);
    }

    public resize(size: PixelPresenterSize): void {
        this.size = size;
        this.notifyResize();
    }

    public showing(pattern: string): boolean {
        return this.latest !== undefined && pixelFrameShowsText(this.latest, pattern);
    }

    public framePainted(): boolean {
        const frame = this.latest;
        return frame !== undefined && frame.widthPx === this.size.widthPx && frame.heightPx === this.size.heightPx
            && frame.pixelsPerScreenUnitX === PIXELS_PER_SCREEN_UNIT_X && frame.pixelsPerScreenUnitY === PIXELS_PER_SCREEN_UNIT_Y;
    }

    public scenePainted(): boolean {
        const frame = this.latest;
        if (frame === undefined) return false;
        const left = Math.floor(frame.widthPx * SCENE_REGION_MARGIN_FRACTION), right = frame.widthPx - left;
        const top = Math.floor(frame.heightPx * SCENE_REGION_MARGIN_FRACTION), bottom = frame.heightPx - top;
        let painted = 0;
        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) if (pixelRgbAt(frame, x, y) !== BLACK_RGB) painted++;
        }
        return painted > (right - left) * (bottom - top) / MIN_SCENE_CELL_DIVISOR;
    }

    public sizeLabel(): string {
        return `${this.size.widthPx}x${this.size.heightPx} px`;
    }
}

type TestDisplay = CellFrameDisplay | PixelFrameDisplay;

class Page {
    public readonly errors: string[] = [];
    public readonly fetched: string[] = [];
    public terminated = false;
    private readonly worker: Worker;
    private readonly connection: WorldWorkerPage;

    public constructor(entry: string, name: string, public readonly display: TestDisplay, isolated: boolean, requestedRasterWorkers?: number) {
        this.worker = new Worker(entry, {
            type: "module",
            preload: [SHIM],
            env: {
                ...process.env,
                JSENGINE_VERIFY_ISOLATED: isolated ? "1" : "0",
                ...(DIST === undefined ? {} : {JSENGINE_VERIFY_DIST: DIST}),
            },
        } as WorkerOptions);
        this.worker.addEventListener("error", event => this.errors.push(event.message));
        this.worker.addEventListener("message", event => {
            const message = event.data as {type?: unknown, url?: unknown};
            if (message?.type === "verify-fetch" && typeof message.url === "string") this.fetched.push(message.url);
        });
        const worker = this.worker as unknown as WorldWorker;
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
            this.terminated = true;
            terminate();
        };
        this.connection = connectWorldWorker(display, worker, {name, requestedRasterWorkers});
    }

    public press(key: Key, modifiers: Modifiers = NO_MODIFIERS): void {
        this.connection.input.enqueue({type: "keyDown", key, repeat: false, ...modifiers});
        this.connection.input.enqueue({type: "keyUp", key, ...modifiers});
    }

    public failedLines(): string {
        return this.display.errors.join(" | ");
    }

    public async quit(label: string, chord: QuitChord = CTRL_C_QUIT): Promise<void> {
        this.press(chord.key, chord.modifiers);
        const stopped = await waitUntil(() => this.display.statusShown(STOPPED_STATUS));
        expect(stopped && this.terminated, `${label}: ${chord.label} quit, the page shows "Stopped" and terminated the worker`);
        const failed = this.failedLines();
        expect(this.errors.length === 0 && failed.length === 0, `${label}: no worker errors${this.errors.length + failed.length > 0 ? ": " + [...this.errors, failed].join(" | ") : ""}`);
    }

    public dispose(): void {
        this.worker.terminate();
    }
}

async function verifyResize(page: Page, label: string, resize: () => void): Promise<void> {
    resize();
    expect(await waitUntil(() => page.display.framePainted()), `${label}: repainted at the new size (${page.display.sizeLabel()})`);
}

async function verify2d(label: string, entry: string, display: TestDisplay, resize: () => void): Promise<void> {
    const page = new Page(entry, "the 2D demo", display, NOT_ISOLATED);
    try {
        expect(await waitUntil(() => display.framePainted()), `${label}: a frame of the page's size (${display.sizeLabel()}) painted on start`);
        expect(await waitUntil(() => display.showing("FPS:")), `${label}: the FPS label rendered`);
        const framesBefore = display.frames;
        await sleep(FRAME_ARRIVAL_WINDOW_MS);
        expect(display.frames > framesBefore, `${label}: frames keep arriving (${display.frames - framesBefore} frame messages in ${FRAME_ARRIVAL_WINDOW_MS} ms)`);
        await verifyResize(page, label, resize);
        await page.quit(label);
    } finally {
        page.dispose();
    }
}

async function verifySwarm(label: string, entry: string, display: TestDisplay, resize: () => void): Promise<void> {
    const page = new Page(entry, "Swarm", display, NOT_ISOLATED);
    try {
        expect(await waitUntil(() => display.framePainted()), `${label}: a frame of the page's size (${display.sizeLabel()}) painted on start`);
        expect(await waitUntil(() => display.showing(SWARM_TITLE)), `${label}: the title "${SWARM_TITLE}" rendered`);
        expect(!display.showing(SWARM_HUD_WAVE), `${label}: the title screen shows no "${SWARM_HUD_WAVE}"`);
        page.press(Key.Enter);
        expect(await waitUntil(() => display.showing(SWARM_HUD_WAVE)), `${label}: Enter started a game and the HUD shows "${SWARM_HUD_WAVE}"`);
        await verifyResize(page, label, resize);
        await page.quit(label, ESCAPE_QUIT);
    } finally {
        page.dispose();
    }
}

function firstLoadMegabytes(page: Page): number | undefined {
    const totals = page.display.statuses.flatMap(status => [...status.matchAll(/Loading assets: \d+\/\d+ files, [\d.]+\/([\d.]+) MB/g)]);
    return totals.length === 0 ? undefined : Number(totals[totals.length - 1][1]);
}

async function verifyLazyModel(page: Page, label: string, manifest: Demo3dManifest): Promise<void> {
    const byPath = new Map(manifest.files.map(file => [file.path, file]));
    const index = manifest.models.findIndex(model => model.files.some(path => byPath.get(path)?.lazy === true));
    expect(index >= 0, `${label}: the manifest has a lazy model`);
    if (index < 0) return;
    const model = manifest.models[index];
    const lazyFiles = model.files.map(path => byPath.get(path)!).filter(file => file.lazy === true);
    const lazyBytes = lazyFiles.reduce((sum, file) => sum + (file.gzipParts?.reduce((total, part) => total + part, 0) ?? file.size), 0);
    const lazyUrls = lazyFiles.map(file => encodeURI(file.path));
    const lazyFetches = () => page.fetched.filter(url => lazyUrls.some(prefix => url.startsWith(prefix)));

    const firstLoad = firstLoadMegabytes(page);
    expect(firstLoad !== undefined && firstLoad * BYTES_PER_MB < lazyBytes, `${label}: the first load (${firstLoad} MB) leaves out ${model.name} (${(lazyBytes / BYTES_PER_MB).toFixed(1)} MB)`);
    const loading = `Loading ${model.name}... `;
    page.display.watch(loading);
    page.display.watch(", 1 to spawn");

    for (let press = 0; press < index; press++) {
        expect(lazyFetches().length === 0, `${label}: ${model.name} not fetched before n selects it (press ${press + 1}/${index})`);
        await sleep(PRESS_INTERVAL_MS);
        page.press(Key.N);
    }
    page.press(Key.Space);
    expect(await waitUntil(() => lazyFetches().length > 0), `${label}: selecting ${model.name} fetched ${lazyFetches().join(", ")}`);
    const spawned = await waitUntil(() => page.display.showing(`Next: ${model.name}  [spawned: 2]`), LAZY_SPAWN_TIMEOUT_MS);
    expect(page.display.shown(loading), `${label}: the HUD showed "${loading}<MB> / <MB> MB" while it downloaded`);
    expect(page.display.shown(", 1 to spawn"), `${label}: the spawn pressed during the download was queued`);
    expect(spawned, `${label}: ${model.name} spawned once its files arrived`);
    expect(await waitUntil(() => !page.display.showing(loading)), `${label}: the download line is gone`);
}

interface Demo3dRun {
    readonly label: string;
    readonly entry: string;
    readonly display: TestDisplay;
    readonly isolated: boolean;
    readonly resize?: () => void;
}

async function verify3d(run: Demo3dRun, manifest: Demo3dManifest): Promise<void> {
    const {label, display, isolated} = run;
    const page = new Page(run.entry, "the 3D demo", display, isolated, isolated ? RASTER_WORKERS : undefined);
    try {
        const expected = isolated ? `Raster workers: ${RASTER_WORKERS}` : "Raster workers: none (single-threaded)";
        expect(await waitUntil(() => display.showing(expected)), `${label}: the HUD shows "${expected}"`);
        expect(display.framePainted(), `${label}: frames have the page's size (${display.sizeLabel()})`);
        expect(await waitUntil(() => display.scenePainted()), `${label}: the scene is painted in 24-bit colour`);
        expect(display.statusShown("Loading assets: "), `${label}: preload progress reached the page`);
        if (isolated) await verifyLazyModel(page, label, manifest);
        if (run.resize !== undefined) await verifyResize(page, label, run.resize);
        await page.quit(label);
    } finally {
        page.dispose();
    }
}

async function main(): Promise<void> {
    if (typeof (globalThis as {Worker?: unknown}).Worker !== "function") {
        log("world worker check: skipped, this runtime has no Web Worker global");
        return;
    }
    if (DIST !== undefined) log(`running the built site in ${DIST}`);
    const manifest = demo3dManifest();

    const cells2d = new CellFrameDisplay(START.columns, START.rows);
    await verify2d("2D", workerEntry("world2d"), cells2d, () => cells2d.resize(RESIZED.columns, RESIZED.rows));
    const pixels2d = new PixelFrameDisplay(PIXEL_START);
    await verify2d("2D pixels", workerEntry("world2d-pixels"), pixels2d, () => pixels2d.resize(PIXEL_RESIZED));

    const cellsSwarm = new CellFrameDisplay(START.columns, START.rows);
    await verifySwarm("Swarm", workerEntry("worldswarm"), cellsSwarm, () => cellsSwarm.resize(RESIZED.columns, RESIZED.rows));
    const pixelsSwarm = new PixelFrameDisplay(PIXEL_START);
    await verifySwarm("Swarm pixels", workerEntry("worldswarm-pixels"), pixelsSwarm, () => pixelsSwarm.resize(PIXEL_RESIZED));

    await verify3d({label: "3D isolated", entry: workerEntry("world3d"), display: new CellFrameDisplay(START.columns, START.rows), isolated: ISOLATED}, manifest);
    await verify3d({label: "3D not isolated", entry: workerEntry("world3d"), display: new CellFrameDisplay(START.columns, START.rows), isolated: NOT_ISOLATED}, manifest);
    const pixels3d = new PixelFrameDisplay(PIXEL_START);
    await verify3d({label: "3D pixels isolated", entry: workerEntry("world3d-pixels"), display: pixels3d, isolated: ISOLATED, resize: () => pixels3d.resize(PIXEL_RESIZED)}, manifest);
    await verify3d({label: "3D pixels not isolated", entry: workerEntry("world3d-pixels"), display: new PixelFrameDisplay(PIXEL_START), isolated: NOT_ISOLATED}, manifest);

    if (failures > 0) {
        console.error(`${failures} world worker failures`);
        process.exit(1);
    }
    log("world worker OK");
    process.exit(0);
}

void main();
