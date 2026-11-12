import {existsSync} from "fs";
import {MeshRasterizer, RasterWorkerPool} from "../src/engine/rendering/3d/software";
import {CellResolveTarget} from "../src/backends/cells/3d/cellResolveTarget";
import {ScreenBuffer} from "../src/backends/cells/cellGrid";
import {Mesh} from "../src/engine/rendering/3d/mesh";
import {LocalToWorld} from "../src/engine/translation";
import {ScreenSize} from "../src/engine/rendering/screenSize";
import {Quaternions} from "../src/engine/math/quaternions";
import {fromFloat32Array, Vec3} from "../src/engine/math/types/vec";
import {ViewSpaceMesh} from "../src/engine/rendering/3d/viewSpaceMesh";
import {SceneLights, VertexLighting} from "../src/engine/rendering/3d/lighting";
import {Texture} from "../src/engine/rendering/3d/texture";
import {Ansi} from "../src/backends/cells/ansiEncoding";
import {browserWorkerFactory} from "../src/hosts/web";
import {nodePlatform} from "../src/hosts/terminal";
import type {WorkerFactory} from "../src/engine/platform";

const WIDTH = 240, HEIGHT = 64, FRAMES = 60;
const WORKERS = 3;
const BOOT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 5;
const HEAVY_MESH_PATH = "./demo/3d/indoor plant_02.obj";
const FALLBACK_MESH_PATH = "./demo/3d/blender_monkey.obj";
const HALF_FOV_RAD = Math.PI / 6;
const CELL_ASPECT_RATIO = 2;
const FULL_COLOR_MASK = 0xFFFFFF;
const WHITE_RGB = 0xFFFFFF;
const SHADE_RGB = 0xF7A44F;
const NO_SUPERSAMPLING = 1;
const MESH_Z = 8;
const MESH_SCALE = 3;
const PITCH_RAD_PER_FRAME = 0.05, YAW_RAD_PER_FRAME = 0.03;
const resolveTarget = new CellResolveTarget();

const screenSize = new ScreenSize();
screenSize.x = WIDTH;
screenSize.y = HEIGHT;
const backgroundChar = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";
const mesh = existsSync(HEAVY_MESH_PATH)
    ? Mesh.fromFile(HEAVY_MESH_PATH, nodePlatform())
    : Mesh.fromFile(FALLBACK_MESH_PATH, nodePlatform());
const invCam = LocalToWorld.invertAffine(new LocalToWorld().matrix);
const focal = HEIGHT / (Math.tan(HALF_FOV_RAD) * 2);

const sceneLights = new SceneLights();
sceneLights.beginGather();
sceneLights.addAmbient(0.1, 0.1, 0.12);
sceneLights.addDirectional(0.3, -1, 0.5, 0.9, 0.9, 0.85);
sceneLights.addPoint(2, 2, 4, 1, 0.5, 0.2, 8);
const vertexLighting = new VertexLighting();
vertexLighting.beginFrame(sceneLights, invCam);
const viewSpaceMesh = new ViewSpaceMesh();
const normalMatrix = new Float32Array(9);

const checker = Texture.fromFile("./demo/3d/checker.png", nodePlatform());
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
    readonly booted: boolean;
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
        if (performance.now() > deadline) return false;
        await sleep(POLL_INTERVAL_MS);
    }
    return true;
}

function renderFrame(rasterizer: MeshRasterizer, frame: number, config: PassConfig): string {
    const transform = new LocalToWorld();
    const quat = Quaternions.eulerToQuat(Vec3.alloc(frame * PITCH_RAD_PER_FRAME, frame * YAW_RAD_PER_FRAME, 0));
    LocalToWorld.fromTRS(transform.matrix, Vec3.alloc(0, 0, MESH_Z), quat, Vec3.alloc(MESH_SCALE, MESH_SCALE, MESH_SCALE));
    const modelView = LocalToWorld.mul(invCam, transform.matrix) as unknown as Float32Array;

    const buffer = new ScreenBuffer();
    buffer.beginFrame({screenSize} as any, backgroundChar);
    resolveTarget.begin(buffer, {colorQuantMask: FULL_COLOR_MASK});
    rasterizer.beginFrame(resolveTarget, WIDTH, HEIGHT, {
        maxDepthFade: 15,
        colorQuantMask: FULL_COLOR_MASK,
        supersample: NO_SUPERSAMPLING,
        workerCount: config.workerCount,
        threadTriangleThreshold: config.threadTriangleThreshold,
        threadAreaThreshold: Number.POSITIVE_INFINITY,
        textures: config.textured,
        halfBlock: config.halfBlock,
    });
    if (config.lit) {
        const viewMesh = viewSpaceMesh.transformFrom(mesh, modelView, LocalToWorld.normalMatrix3(fromFloat32Array<16>(modelView), normalMatrix));
        rasterizer.addViewSpaceMesh(mesh, viewMesh, focal, CELL_ASPECT_RATIO, WHITE_RGB, vertexLighting.shade(viewMesh, SHADE_RGB));
    } else {
        rasterizer.addMesh(mesh, modelView, focal, CELL_ASPECT_RATIO, WHITE_RGB);
    }
    rasterizer.endFrame();
    return buffer.flush();
}

async function renderAll(workers: WorkerFactory, config: PassConfig): Promise<PassResult> {
    const rasterizer = new MeshRasterizer(workers);
    let booted = true;
    if (config.workerCount > 0) {
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

function constructPoolOrUndefined(workers: WorkerFactory, prefix: string): RasterWorkerPool | undefined {
    try {
        const pool = new RasterWorkerPool(WORKERS, workers);
        console.log(`${prefix}pool constructed: workers=${pool.workerCount} usable=${pool.usable}`);
        return pool;
    } catch (error) {
        console.log(`${prefix}pool construction FAILED:`, error);
        return undefined;
    }
}

async function allPassesMatch(workers: WorkerFactory, labelOrUndefined?: string): Promise<boolean> {
    const prefix = labelOrUndefined === undefined ? "" : labelOrUndefined + " ";
    const pool = constructPoolOrUndefined(workers, prefix);

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
    if (!await allPassesMatch(nodePlatform().workers!)) process.exit(1);
    console.log("threading OK");

    if (typeof (globalThis as {Worker?: unknown}).Worker !== "function") {
        console.log("browser worker factory: skipped, this runtime has no Web Worker global");
        return;
    }
    if (!await allPassesMatch(browserWorkerFactory(), "browser workers")) process.exit(1);
    console.log("browser worker factory OK");
}

void main();
