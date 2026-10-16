/**
 * Runs the browser pages' world workers for real: web/world2d.worker.ts and web/world3d.worker.ts
 * in bun module Web Workers, as the pages spawn them, with this script playing the page:
 * connectWorldWorker over a model of xterm.js that acknowledges each write once "parsed". Checks
 * the protocol end to end: init, whole frames, a resize, Ctrl+C -> quit -> "Stopped", no errors.
 * The 3D worker runs twice: cross-origin isolated, where its raster runs on nested Web Workers
 * from the browser factory and the HUD must say so, and not isolated, the single-threaded
 * fallback. tests/worldWorkerShim.ts supplies relative fetches and the isolation flag, which
 * bun's workers lack. The isolated run also checks the lazy model (the bugatti): left out of the
 * first load, fetched only once `n` selects it, a spawn queued meanwhile, then spawned.
 *
 * Run: bun tests/verifyWorldWorker.ts
 *      bun tests/verifyWorldWorker.ts --dist web/dist-prod   the built bundles instead of web/*.ts,
 *      fetching from that site (minified code, gzip-compressed and chunked assets)
 */
import {readFileSync} from "fs";
import {join, resolve} from "path";
import {connectWorldWorker} from "../src/js_engine/platform";
import type {PageTerminal, TerminalSubscription, WorldWorker} from "../src/js_engine/platform";
import {Ansi} from "../src/js_engine/rendering/console";
import {TerminalScreen} from "../src/js_engine/testing/terminalScreen";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest} from "../demo/3d/assets";

const ROOT = resolve(__dirname, "..");
const SHIM = join(ROOT, "tests", "worldWorkerShim.ts");
const DIST_ARG = process.argv.indexOf("--dist");
const DIST = DIST_ARG < 0 ? undefined : resolve(process.argv[DIST_ARG + 1] ?? "web/dist-prod");
const CTRL_C = "\x03";
const START = {columns: 120, rows: 40};
const RESIZED = {columns: 160, rows: 50};
const RASTER_WORKERS = 3;
const TIMEOUT_MS = 20_000;
/** Loading a lazy model includes decoding its mesh cache in the worker and drawing it. */
const LAZY_SPAWN_TIMEOUT_MS = 60_000;
/** Longer than the input's synthetic key-release delay, so the next press of a key is a fresh one. */
const KEY_RELEASE_WAIT_MS = 200;
const MB = 1024 * 1024;

function workerEntry(name: string): string {
    return DIST === undefined ? join(ROOT, "web", `${name}.worker.ts`) : join(DIST, `${name}.worker.js`);
}

function demo3dManifest(): Demo3dManifest {
    if (DIST === undefined) return buildDemo3dManifest(ROOT);
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
        await sleep(10);
    }
    return true;
}

/** xterm.js as the page sees it: a screen model, and each write "parsed" on the next task. */
class ModelTerminal implements PageTerminal {
    public readonly screen: TerminalScreen;
    public transcript = "";
    public writes = 0;
    private readonly dataListeners = new Set<(data: string) => void>();
    private readonly resizeListeners = new Set<(size: {cols: number, rows: number}) => void>();
    /** Text to look for on the screen after every write, and whether it has shown yet. */
    private readonly watched = new Map<string, boolean>();

    public constructor(public cols: number, public rows: number) {
        this.screen = new TerminalScreen(cols, rows);
    }

    public write(data: string, callback?: () => void): void {
        this.screen.write(data);
        this.transcript += data;
        this.writes++;
        if (this.watched.size > 0) {
            const text = this.screen.text();
            for (const [pattern, seen] of this.watched) if (!seen && text.includes(pattern)) this.watched.set(pattern, true);
        }
        if (callback !== undefined) setTimeout(callback, 0);
    }

    public watch(pattern: string): void {
        this.watched.set(pattern, this.screen.text().includes(pattern));
    }

    public shown(pattern: string): boolean {
        return this.watched.get(pattern) === true;
    }

    public showing(pattern: string): boolean {
        return this.screen.text().includes(pattern);
    }

    public onData(listener: (data: string) => void): TerminalSubscription {
        this.dataListeners.add(listener);
        return {dispose: () => this.dataListeners.delete(listener)};
    }

    public onResize(listener: (size: {cols: number, rows: number}) => void): TerminalSubscription {
        this.resizeListeners.add(listener);
        return {dispose: () => this.resizeListeners.delete(listener)};
    }

    public type(data: string): void {
        for (const listener of [...this.dataListeners]) listener(data);
    }

    public resize(cols: number, rows: number): void {
        this.cols = cols;
        this.rows = rows;
        this.screen.resize(cols, rows);
        for (const listener of [...this.resizeListeners]) listener({cols, rows});
    }

    public text(): string {
        return Ansi.strip(this.transcript);
    }

    /** The frame is one row short of the terminal: the last row is left for the prompt. */
    public framePainted(): boolean {
        return this.screen.writtenCells(this.cols, this.rows - 1) === this.cols * (this.rows - 1);
    }
}

class Page {
    public readonly terminal = new ModelTerminal(START.columns, START.rows);
    public readonly errors: string[] = [];
    /** Every URL the world worker fetched, in order (reported by the shim). */
    public readonly fetched: string[] = [];
    public terminated = false;
    private readonly worker: Worker;

    public constructor(entry: string, name: string, isolated: boolean, requestedRasterWorkers?: number) {
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
        connectWorldWorker(this.terminal, worker, {name, requestedRasterWorkers});
    }

    public failedLines(): string {
        return this.terminal.text().split("\n").filter(line => line.includes("Could not start") || line.includes("Error in")).join(" | ");
    }

    public async quit(label: string): Promise<void> {
        this.terminal.type(CTRL_C);
        const stopped = await waitUntil(() => this.terminal.text().includes("Stopped. Reload the page to restart."));
        expect(stopped && this.terminated, `${label}: Ctrl+C quit, the page shows "Stopped" and terminated the worker`);
        const failed = this.failedLines();
        expect(this.errors.length === 0 && failed.length === 0, `${label}: no worker errors${this.errors.length + failed.length > 0 ? ": " + [...this.errors, failed].join(" | ") : ""}`);
    }

    public dispose(): void {
        this.worker.terminate();
    }
}

async function verify2d(): Promise<void> {
    const page = new Page(workerEntry("world2d"), "the 2D demo", false);
    try {
        expect(await waitUntil(() => page.terminal.framePainted()), "2D: every frame cell painted on start");
        expect(await waitUntil(() => page.terminal.text().includes("FPS:")), "2D: the FPS label rendered");
        const writesBefore = page.terminal.writes;
        await sleep(300);
        expect(page.terminal.writes > writesBefore, `2D: frames keep arriving (${page.terminal.writes - writesBefore} output messages in 300 ms)`);

        page.terminal.resize(RESIZED.columns, RESIZED.rows);
        expect(await waitUntil(() => page.terminal.framePainted()), `2D: repainted at the new size (${RESIZED.columns}x${RESIZED.rows})`);
        await page.quit("2D");
    } finally {
        page.dispose();
    }
}

/** The last "Loading assets" line's total, in MB. */
function firstLoadMegabytes(page: Page): number | undefined {
    const totals = [...page.terminal.text().matchAll(/Loading assets: \d+\/\d+ files, [\d.]+\/([\d.]+) MB/g)];
    return totals.length === 0 ? undefined : Number(totals[totals.length - 1][1]);
}

/**
 * Selects the manifest's lazy model with `n` and spawns it with space straight away, while its
 * files are still on the way: it must not be fetched before it is selected, must show its
 * download in the HUD, and must spawn once it has arrived.
 */
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
    expect(firstLoad !== undefined && firstLoad * MB < lazyBytes, `${label}: the first load (${firstLoad} MB) leaves out ${model.name} (${(lazyBytes / MB).toFixed(1)} MB)`);
    const loading = `Loading ${model.name}... `;
    page.terminal.watch(loading);
    page.terminal.watch(", 1 to spawn");

    for (let press = 0; press < index; press++) {
        expect(lazyFetches().length === 0, `${label}: ${model.name} not fetched before n selects it (press ${press + 1}/${index})`);
        await sleep(KEY_RELEASE_WAIT_MS);
        page.terminal.type("n");
    }
    page.terminal.type(" ");
    expect(await waitUntil(() => lazyFetches().length > 0), `${label}: selecting ${model.name} fetched ${lazyFetches().join(", ")}`);
    const spawned = await waitUntil(() => page.terminal.showing(`Next: ${model.name}  [spawned: 2]`), LAZY_SPAWN_TIMEOUT_MS);
    expect(page.terminal.shown(loading), `${label}: the HUD showed "${loading}<MB> / <MB> MB" while it downloaded`);
    expect(page.terminal.shown(", 1 to spawn"), `${label}: the spawn pressed during the download was queued`);
    expect(spawned, `${label}: ${model.name} spawned once its files arrived`);
    expect(await waitUntil(() => !page.terminal.showing(loading)), `${label}: the download line is gone`);
}

async function verify3d(isolated: boolean, manifest: Demo3dManifest): Promise<void> {
    const label = isolated ? "3D isolated" : "3D not isolated";
    const page = new Page(workerEntry("world3d"), "the 3D demo", isolated, isolated ? RASTER_WORKERS : undefined);
    try {
        const expected = isolated ? `Raster workers: ${RASTER_WORKERS}` : "Raster workers: none (single-threaded)";
        expect(await waitUntil(() => page.terminal.text().includes(expected)), `${label}: the HUD shows "${expected}"`);
        const frameCells = page.terminal.cols * (page.terminal.rows - 1);
        expect(await waitUntil(() => page.terminal.screen.truecolorCells() > frameCells / 50), `${label}: the scene is painted in 24-bit colour (${page.terminal.screen.truecolorCells()}/${frameCells})`);
        expect(page.terminal.text().includes("Loading assets: "), `${label}: preload progress reached the page`);
        if (isolated) await verifyLazyModel(page, label, manifest);
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
    await verify2d();
    await verify3d(true, manifest);
    await verify3d(false, manifest);
    if (failures > 0) {
        console.error(`${failures} world worker failures`);
        process.exit(1);
    }
    log("world worker OK");
    process.exit(0);
}

void main();
