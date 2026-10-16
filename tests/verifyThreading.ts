/**
 * Confirms the raster worker pool actually spins up on this runtime, that
 * threaded output is bit-identical to single-threaded output, and how the two
 * compare on time for a heavy mesh.
 *
 * Runs once through the node platform's workers (worker_threads), then again
 * through the browser's WorkerFactory (Web Workers from blob URLs, the factory a
 * cross-origin isolated page uses) where the runtime has a Web Worker global, as
 * bun does. Every threaded run waits for its workers to boot first, so its frames
 * are rasterized by the workers and not by the synchronous boot fallback.
 *
 * Run: bun tests/verifyThreading.ts
 */
import {MeshRasterizer, RasterWorkerPool} from "../src/js_engine/rendering/3d/software";
import {ConsoleCellResolveTarget} from "../src/js_engine/rendering/console/3d/consoleCellResolveTarget";
import {ScreenBuffer} from "../src/js_engine/rendering/console/consoleScreenBuffer";
import {Mesh} from "../src/js_engine/rendering/3d/mesh";
import {LocalToWorld} from "../src/js_engine/translation";
import {ScreenSize} from "../src/js_engine/rendering/screenSize";
import {Quaternions} from "../src/js_engine/math/quaternions";
import {fromFloat32Array, Vec3} from "../src/js_engine/math/types/vec";
import {ViewSpaceMesh} from "../src/js_engine/rendering/3d/viewSpaceMesh";
import {SceneLights, VertexLighting} from "../src/js_engine/rendering/3d/lighting";
import {Texture} from "../src/js_engine/rendering/3d/texture";
import {Ansi} from "../src/js_engine/rendering/console/ansi";
import {browserWorkerFactory, nodePlatform} from "../src/js_engine/platform";
import type {WorkerFactory} from "../src/js_engine/platform";

const WIDTH = 240, HEIGHT = 64, FRAMES = 60;
const WORKERS = 3;
const BOOT_TIMEOUT_MS = 5000;
const resolveTarget = new ConsoleCellResolveTarget();

const screenSize = new ScreenSize();
screenSize.x = WIDTH;
screenSize.y = HEIGHT;
const backgroundChar = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";
// Prefer the heavy plant mesh when present (not checked into the repo).
const mesh = require("fs").existsSync("./demo/3d/indoor plant_02.obj")
    ? Mesh.fromFile("./demo/3d/indoor plant_02.obj")
    : Mesh.fromFile("./demo/3d/blender_monkey.obj");
const invCam = LocalToWorld.invertAffine(new LocalToWorld().matrix);
const focal = HEIGHT / (Math.tan(Math.PI / 6) * 2);

const sceneLights = new SceneLights();
sceneLights.beginGather();
sceneLights.addAmbient(0.1, 0.1, 0.12);
sceneLights.addDirectional(0.3, -1, 0.5, 0.9, 0.9, 0.85);
sceneLights.addPoint(2, 2, 4, 1, 0.5, 0.2, 8);
const vertexLighting = new VertexLighting();
vertexLighting.beginFrame(sceneLights, invCam);
const viewSpaceMesh = new ViewSpaceMesh();
const normalMatrix = new Float32Array(9);

const checker = Texture.fromFile("./demo/3d/checker.png");
for (const material of mesh.materials) material.diffuseTexture = checker;

interface PassConfig {
    readonly workerCount: number;
    readonly threadTriangleThreshold: number;
    readonly lit: boolean;
    readonly textured: boolean;
    readonly halfBlock: boolean;
}

interface PassResult {
    readonly ms: number;
    readonly frames: string[];
    readonly poolUsable: boolean;
    /** Every worker had booted before the first measured frame (always true for a synchronous run). */
    readonly booted: boolean;
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
        if (performance.now() > deadline) return false;
        await sleep(5);
    }
    return true;
}

function renderFrame(rasterizer: MeshRasterizer, frame: number, config: PassConfig): string {
    const transform = new LocalToWorld();
    const quat = Quaternions.eulerToQuat(Vec3.alloc(frame * 0.05, frame * 0.03, 0));
    LocalToWorld.fromTRS(transform.matrix, Vec3.alloc(0, 0, 8), quat, Vec3.alloc(3, 3, 3));
    const modelView = LocalToWorld.mul(invCam, transform.matrix) as unknown as Float32Array;

    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize} as any, backgroundChar);
    resolveTarget.begin(buffer, {colorQuantMask: 0xFFFFFF});
    rasterizer.beginFrame(resolveTarget, WIDTH, HEIGHT, {
        maxDepthFade: 15,
        colorQuantMask: 0xFFFFFF,
        supersample: 1, // AA off: this test compares threaded vs single-threaded output bit for bit
        workerCount: config.workerCount,
        threadTriangleThreshold: config.threadTriangleThreshold,
        threadAreaThreshold: Number.POSITIVE_INFINITY,
        textures: config.textured,
        halfBlock: config.halfBlock,
    });
    if (config.lit) {
        const viewMesh = viewSpaceMesh.transformFrom(mesh, modelView, LocalToWorld.normalMatrix3(fromFloat32Array<16>(modelView), normalMatrix));
        rasterizer.addViewSpaceMesh(mesh, viewMesh, focal, 2, 0xFFFFFF, vertexLighting.shade(viewMesh, 0xF7A44F));
    } else {
        rasterizer.addMesh(mesh, modelView, focal, 2, 0xFFFFFF);
    }
    rasterizer.endFrame();
    return buffer.flush();
}

async function renderAll(workers: WorkerFactory, config: PassConfig): Promise<PassResult> {
    const rasterizer = new MeshRasterizer(workers);
    let booted = true;
    if (config.workerCount > 0) {
        // The first frame creates the pool; its workers boot while we wait.
        renderFrame(rasterizer, 0, config);
        booted = await waitUntil(() => rasterizer.activeWorkerCount === config.workerCount, BOOT_TIMEOUT_MS);
    }
    const frames: string[] = [];
    const start = performance.now();
    for (let f = 0; f < FRAMES; f++) frames.push(renderFrame(rasterizer, f, config));
    const ms = performance.now() - start;
    const poolUsable = ((rasterizer as any).pool?.usable ?? false) && !(rasterizer as any).poolBroken;
    rasterizer.dispose();
    return {ms, frames, poolUsable, booted};
}

const passes = [
    ["unlit", false, false, false],
    ["lit", true, false, false],
    ["lit+textured", true, true, false],
    ["lit+textured+halfblock", true, true, true],
] as const;

/** Every pass threaded through `workers` and synchronously; true when all match. `name` prefixes the labels. */
async function verifyFactory(workers: WorkerFactory, name?: string): Promise<boolean> {
    const prefix = name === undefined ? "" : name + " ";
    // Direct pool sanity check first.
    let pool: RasterWorkerPool | undefined;
    try {
        pool = new RasterWorkerPool(WORKERS, workers);
        console.log(`${prefix}pool constructed: workers=${pool.workerCount} usable=${pool.usable}`);
    } catch (error) {
        console.log(`${prefix}pool construction FAILED:`, error);
    }

    let failed = false;
    for (const [pass, lit, textured, halfBlock] of passes) {
        const label = prefix + pass;
        const threaded = await renderAll(workers, {workerCount: WORKERS, threadTriangleThreshold: 1, lit, textured, halfBlock});
        const sync = await renderAll(workers, {workerCount: 0, threadTriangleThreshold: Number.MAX_SAFE_INTEGER, lit, textured, halfBlock});

        let identical = 0;
        let bytes = 0;
        for (let f = 0; f < FRAMES; f++) {
            if (threaded.frames[f] === sync.frames[f]) identical++;
            bytes += sync.frames[f].length;
        }

        console.log(`[${label}] threaded: ${(threaded.ms / FRAMES).toFixed(3)} ms/frame | sync: ${(sync.ms / FRAMES).toFixed(3)} ms/frame | ${(bytes / FRAMES).toFixed(0)} bytes/frame`);
        console.log(`[${label}] identical frames: ${identical}/${FRAMES} | workers booted: ${threaded.booted} | pool survived threaded run: ${threaded.poolUsable}`);

        if (identical !== FRAMES) {
            console.error(`THREADING MISMATCH [${label}]: threaded output differs from single-threaded output`);
            failed = true;
        }
        if (!threaded.booted) {
            console.error(`THREADING FAILURE [${label}]: workers did not boot within ${BOOT_TIMEOUT_MS} ms, so the frames were rasterized synchronously`);
            failed = true;
        }
        if (!threaded.poolUsable) {
            console.error(`THREADING FAILURE [${label}]: pool broke during the threaded run (fell back to sync)`);
            failed = true;
        }
    }
    pool?.dispose();
    return !failed;
}

async function main(): Promise<void> {
    if (!await verifyFactory(nodePlatform().workers!)) process.exit(1);
    console.log("threading OK");

    if (typeof (globalThis as {Worker?: unknown}).Worker !== "function") {
        console.log("browser worker factory: skipped, this runtime has no Web Worker global");
        return;
    }
    if (!await verifyFactory(browserWorkerFactory(), "browser workers")) process.exit(1);
    console.log("browser worker factory OK");
}

void main();
