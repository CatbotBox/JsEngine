/**
 * Runs the browser pages' world workers for real: web/world2d.worker.ts and web/world3d.worker.ts
 * in bun module Web Workers, as the pages spawn them, with this script playing the page:
 * connectWorldWorker over a model of xterm.js that acknowledges each write once "parsed". Checks
 * the protocol end to end: init, whole frames, a resize, Ctrl+C -> quit -> "Stopped", no errors.
 * The 3D worker runs twice: cross-origin isolated, where its raster runs on nested Web Workers
 * from the browser factory and the HUD must say so, and not isolated, the single-threaded
 * fallback. tests/worldWorkerShim.ts supplies relative fetches and the isolation flag, which
 * bun's workers lack.
 *
 * Run: bun tests/verifyWorldWorker.ts
 */
import {join, resolve} from "path";
import {connectWorldWorker} from "../src/js_engine/platform";
import type {PageTerminal, TerminalSubscription, WorldWorker} from "../src/js_engine/platform";
import {Ansi} from "../src/js_engine/rendering/console";
import {TerminalScreen} from "../src/js_engine/testing/terminalScreen";

const ROOT = resolve(__dirname, "..");
const SHIM = join(ROOT, "tests", "worldWorkerShim.ts");
const CTRL_C = "\x03";
const START = {columns: 120, rows: 40};
const RESIZED = {columns: 160, rows: 50};
const RASTER_WORKERS = 3;
const TIMEOUT_MS = 20_000;

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

    public constructor(public cols: number, public rows: number) {
        this.screen = new TerminalScreen(cols, rows);
    }

    public write(data: string, callback?: () => void): void {
        this.screen.write(data);
        this.transcript += data;
        this.writes++;
        if (callback !== undefined) setTimeout(callback, 0);
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
    public terminated = false;
    private readonly worker: Worker;

    public constructor(entry: string, name: string, isolated: boolean, requestedRasterWorkers?: number) {
        this.worker = new Worker(join(ROOT, "web", entry), {
            type: "module",
            preload: [SHIM],
            env: {...process.env, JSENGINE_VERIFY_ISOLATED: isolated ? "1" : "0"},
        } as WorkerOptions);
        this.worker.addEventListener("error", event => this.errors.push(event.message));
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
    const page = new Page("world2d.worker.ts", "the 2D demo", false);
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

async function verify3d(isolated: boolean): Promise<void> {
    const label = isolated ? "3D isolated" : "3D not isolated";
    const page = new Page("world3d.worker.ts", "the 3D demo", isolated, isolated ? RASTER_WORKERS : undefined);
    try {
        const expected = isolated ? `Raster workers: ${RASTER_WORKERS}` : "Raster workers: none (single-threaded)";
        expect(await waitUntil(() => page.terminal.text().includes(expected)), `${label}: the HUD shows "${expected}"`);
        const frameCells = page.terminal.cols * (page.terminal.rows - 1);
        expect(await waitUntil(() => page.terminal.screen.truecolorCells() > frameCells / 50), `${label}: the scene is painted in 24-bit colour (${page.terminal.screen.truecolorCells()}/${frameCells})`);
        expect(page.terminal.text().includes("Loading assets: "), `${label}: preload progress reached the page`);
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
    await verify2d();
    await verify3d(true);
    await verify3d(false);
    if (failures > 0) {
        console.error(`${failures} world worker failures`);
        process.exit(1);
    }
    log("world worker OK");
    process.exit(0);
}

void main();
