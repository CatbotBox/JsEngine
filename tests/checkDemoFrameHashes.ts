import {createHash} from "crypto";
import type {Hash} from "crypto";
import {existsSync, readFileSync, writeFileSync} from "fs";
import {join, relative, resolve} from "path";
import {App} from "../src/engine/core";
import {Input} from "../src/engine/input";
import {consoleOverride} from "../src/engine/debugging";
import {originalConsole} from "../src/engine/debugging/originalConsole";
import {MemoryPlatform, MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import type {PixelFrame, PixelPresenter, PixelPresenterSize} from "../src/backends/pixels";
import {AnsiCellPresenter, nodePlatform} from "../src/hosts/terminal";
import {demoFrameHashFiles, startDemoForFrameHashes} from "./support/demoFrameHashLaunch";
import type {HashedBackend, HashedDemo, HashedOutput} from "./support/demoFrameHashLaunch";
import {DEMO_FRAME_HASH_SCRIPTS, ScriptedInput} from "./support/demoFrameHashScripts";

const ROOT = resolve(__dirname, "..");
const BASELINE_PATH = join(__dirname, "demoFrameHashes.baseline.txt");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const FRAME_MS = 1000 / 60;
const RANDOM_SEED = 20261116;
const CELL_SIZE = {columns: 120, rows: 40};
const PIXEL_SIZE: PixelPresenterSize = {widthPx: 640, heightPx: 384};
const NO_FRAME_MARKER = "no frame";
const PIXEL_FRAME_HEADER_FIELDS = 4;
const MS_PER_SECOND = 1000;
const SECONDS_DECIMALS = 1;

const MULBERRY32_INCREMENT = 0x6D2B79F5;
const MULBERRY32_FIRST_SHIFT = 15;
const MULBERRY32_SECOND_SHIFT = 7;
const MULBERRY32_THIRD_SHIFT = 14;
const MULBERRY32_ODD_MULTIPLIER = 61;
const LOWEST_BIT = 1;
const UINT32_RANGE = 2 ** 32;

interface HashCase {
    readonly demo: HashedDemo;
    readonly backend: HashedBackend;
}

const CASES: readonly HashCase[] = [
    {demo: "swarm", backend: "cells"},
    {demo: "swarm", backend: "pixels"},
    {demo: "2d", backend: "cells"},
    {demo: "2d", backend: "pixels"},
    {demo: "3d", backend: "cells"},
    {demo: "3d", backend: "pixels"},
];

interface SegmentResult {
    readonly label: string;
    readonly ticks: number;
    readonly frames: number;
    readonly sha1: string;
}

function log(message: string): void {
    process.stdout.write(message + "\n");
}

class DeterministicRuntime {
    private readonly realNow = performance.now;
    private readonly realRandom = Math.random;
    private clockMs = 0;
    private randomState = 0;

    public install(seed: number): void {
        this.clockMs = 0;
        this.randomState = seed >>> 0;
        Object.defineProperty(performance, "now", {value: () => this.clockMs, configurable: true, writable: true});
        Math.random = () => this.nextRandom();
    }

    public advance(ms: number): void {
        this.clockMs += ms;
    }

    public restore(): void {
        Object.defineProperty(performance, "now", {value: this.realNow, configurable: true, writable: true});
        Math.random = this.realRandom;
    }

    private nextRandom(): number {
        this.randomState = (this.randomState + MULBERRY32_INCREMENT) | 0;
        let mixed = this.randomState;
        mixed = Math.imul(mixed ^ (mixed >>> MULBERRY32_FIRST_SHIFT), mixed | LOWEST_BIT);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> MULBERRY32_SECOND_SHIFT), mixed | MULBERRY32_ODD_MULTIPLIER);
        return ((mixed ^ (mixed >>> MULBERRY32_THIRD_SHIFT)) >>> 0) / UINT32_RANGE;
    }
}

class SegmentHashes {
    private readonly order: string[] = [];
    private readonly hashes = new Map<string, Hash>();
    private readonly ticks = new Map<string, number>();
    private readonly frames = new Map<string, number>();
    private current = "";

    public begin(segment: string): void {
        this.current = segment;
        if (this.hashes.has(segment)) return;
        this.order.push(segment);
        this.hashes.set(segment, createHash("sha1"));
        this.ticks.set(segment, 0);
        this.frames.set(segment, 0);
    }

    public addFrame(...parts: readonly (Uint8Array | string)[]): void {
        const hash = this.hashes.get(this.current)!;
        for (const part of parts) hash.update(part);
        this.frames.set(this.current, this.frames.get(this.current)! + 1);
    }

    public endTick(presented: boolean): void {
        if (!presented) this.hashes.get(this.current)!.update(NO_FRAME_MARKER);
        this.ticks.set(this.current, this.ticks.get(this.current)! + 1);
    }

    public results(prefix: string): SegmentResult[] {
        return this.order.map(segment => ({
            label: `${prefix} ${segment}`,
            ticks: this.ticks.get(segment)!,
            frames: this.frames.get(segment)!,
            sha1: this.hashes.get(segment)!.digest("hex"),
        }));
    }
}

interface FrameRecorder {
    endTick(): void;
}

class HashingPixelPresenter implements PixelPresenter, FrameRecorder {
    private presentedThisTick = false;
    private readonly header = new Int32Array(PIXEL_FRAME_HEADER_FIELDS);

    public constructor(private readonly segments: SegmentHashes, private readonly pixelSize: PixelPresenterSize) {
    }

    public size(): PixelPresenterSize {
        return this.pixelSize;
    }

    public onResize(): () => void {
        return () => undefined;
    }

    public start(): void {
    }

    public stop(): void {
    }

    public present(frame: PixelFrame): void {
        this.header.set([frame.widthPx, frame.heightPx, frame.pixelsPerScreenUnitX, frame.pixelsPerScreenUnitY]);
        this.segments.addFrame(new Uint8Array(this.header.buffer), new Uint8Array(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength));
        this.presentedThisTick = true;
    }

    public endTick(): void {
        this.segments.endTick(this.presentedThisTick);
        this.presentedThisTick = false;
    }
}

class TerminalOutputRecorder implements FrameRecorder {
    public constructor(private readonly segments: SegmentHashes, private readonly terminal: MemoryTerminal) {
    }

    public endTick(): void {
        const written = this.terminal.text();
        this.terminal.clear();
        if (written.length > 0) this.segments.addFrame(written);
        this.segments.endTick(written.length > 0);
    }
}

interface RecordedOutput {
    readonly output: HashedOutput;
    readonly recorder: FrameRecorder;
}

function recordedOutput(backend: HashedBackend, segments: SegmentHashes): RecordedOutput {
    if (backend === "cells") {
        const terminal = new MemoryTerminal(CELL_SIZE);
        return {output: {backend, presenter: new AnsiCellPresenter(terminal)}, recorder: new TerminalOutputRecorder(segments, terminal)};
    }
    const presenter = new HashingPixelPresenter(segments, PIXEL_SIZE);
    return {output: {backend, presenter}, recorder: presenter};
}

async function runCase(hashCase: HashCase, runtime: DeterministicRuntime, errors: string[]): Promise<SegmentResult[]> {
    const label = `${hashCase.demo}/${hashCase.backend}`;
    runtime.install(RANDOM_SEED);
    const host = nodePlatform();
    const platform = new MemoryPlatform({fileSource: demoFrameHashFiles(hashCase.demo, host.files), inflate: host.inflate});
    const world = new App({platform}).createDebugWorld();
    const segments = new SegmentHashes();
    const {output, recorder} = recordedOutput(hashCase.backend, segments);
    const keys = new ScriptedInput(world.resources.getOrCreate(Input));
    try {
        await startDemoForFrameHashes({demo: hashCase.demo, output, world});
        for (const phase of DEMO_FRAME_HASH_SCRIPTS[hashCase.demo]) {
            segments.begin(phase.segment);
            phase.atStart?.(keys);
            for (let tick = 0; tick < phase.ticks; tick++) {
                phase.eachTick?.(tick, keys);
                world.step(FRAME_MS);
                platform.advance(FRAME_MS);
                runtime.advance(FRAME_MS);
                recorder.endTick();
            }
        }
    } finally {
        world.stop();
        runtime.restore();
    }
    if (platform.quitCount > 0) errors.push(`${label}: the script made the demo quit (${platform.quitCount})`);
    return segments.results(label);
}

function baselineLine(result: SegmentResult): string {
    return `${result.label} ticks=${result.ticks} frames=${result.frames} sha1=${result.sha1}`;
}

function readBaseline(): Map<string, string> {
    const baseline = new Map<string, string>();
    if (!existsSync(BASELINE_PATH)) return baseline;
    for (const line of readFileSync(BASELINE_PATH, "utf8").split(/\r?\n/)) {
        const match = /^(\S+ \S+) (.*)$/.exec(line.trim());
        if (match !== null) baseline.set(match[1], match[2]);
    }
    return baseline;
}

async function main(): Promise<void> {
    process.chdir(ROOT);
    const errors: string[] = [];
    const errorRecorder: Console = Object.create(originalConsole);
    errorRecorder.error = (...data: unknown[]) => errors.push(data.map(String).join(" "));
    consoleOverride.addConsoleEventListener(errorRecorder);
    const runtime = new DeterministicRuntime();
    const started = performance.now();
    const results: SegmentResult[] = [];
    for (const hashCase of CASES) results.push(...await runCase(hashCase, runtime, errors));
    consoleOverride.removeConsoleEventListener(errorRecorder);
    const elapsed = `${((performance.now() - started) / MS_PER_SECOND).toFixed(SECONDS_DECIMALS)} s`;
    const baselineName = relative(ROOT, BASELINE_PATH).replace(/\\/g, "/");

    if (errors.length > 0) {
        console.error(`the demo frame hash run logged ${errors.length} error(s):`);
        for (const error of errors) console.error(`  ${error}`);
        process.exit(1);
    }

    if (UPDATE_BASELINE) {
        writeFileSync(BASELINE_PATH, results.map(baselineLine).join("\n") + "\n");
        for (const result of results) log(baselineLine(result));
        log(`wrote ${baselineName} (${elapsed})`);
        return;
    }
    const baseline = readBaseline();
    const mismatches: string[] = [];
    for (const result of results) {
        const expected = baseline.get(result.label);
        const actual = baselineLine(result).slice(result.label.length + 1);
        const matches = expected === actual;
        log(`${matches ? "ok      " : "MISMATCH"} ${baselineLine(result)}`);
        if (!matches) mismatches.push(`${result.label}: expected ${expected ?? "(no baseline entry)"}, got ${actual}`);
    }
    const unchecked = [...baseline.keys()].filter(label => !results.some(result => result.label === label));
    for (const label of unchecked) mismatches.push(`${label}: in the baseline but not produced by this run`);
    if (mismatches.length > 0) {
        console.error(`${mismatches.length} demo frame hash segment(s) differ from ${baselineName}:`);
        for (const mismatch of mismatches) console.error(`  ${mismatch}`);
        console.error("If the change is intended, rerun with --update-baseline.");
        process.exit(1);
    }
    log(`all ${results.length} demo frame hash segments match ${baselineName} (${elapsed})`);
}

void main();
