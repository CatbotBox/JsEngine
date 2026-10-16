/**
 * Confirms the raster worker pool actually spins up on this runtime, that
 * threaded output is bit-identical to single-threaded output, and how the two
 * compare on time for a heavy mesh.
 *
 * Run: bun tests/verifyThreading.ts
 */
import {MeshRasterizer} from "../src/js_engine/rendering/console/3d/meshRasterizer";
import {RasterWorkerPool} from "../src/js_engine/rendering/console/3d/rasterWorkerPool";
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
import {nodePlatform} from "../src/js_engine/platform";

const WIDTH = 240, HEIGHT = 64, FRAMES = 60;
const workers = nodePlatform().workers!;

// Direct pool sanity check first.
let pool: RasterWorkerPool | undefined;
try {
    pool = new RasterWorkerPool(3, workers);
    console.log(`pool constructed: workers=${pool.workerCount} usable=${pool.usable}`);
} catch (error) {
    console.log("pool construction FAILED:", error);
}

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

function renderAll(config: { workerCount: number, threadTriangleThreshold: number, lit: boolean, textured: boolean, halfBlock: boolean }): { ms: number, frames: string[], poolUsable: boolean } {
    const rasterizer = new MeshRasterizer(workers);
    const frames: string[] = [];
    const start = performance.now();
    for (let f = 0; f < FRAMES; f++) {
        const transform = new LocalToWorld();
        const quat = Quaternions.eulerToQuat(Vec3.alloc(f * 0.05, f * 0.03, 0));
        LocalToWorld.fromTRS(transform.matrix, Vec3.alloc(0, 0, 8), quat, Vec3.alloc(3, 3, 3));
        const modelView = LocalToWorld.mul(invCam, transform.matrix) as unknown as Float32Array;

        const buffer = new ScreenBuffer();
        buffer.beginFrame({screenSize} as any, backgroundChar);
        rasterizer.beginFrame(buffer, WIDTH, HEIGHT, {
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
        frames.push(buffer.flush());
    }
    const ms = performance.now() - start;
    const poolUsable = ((rasterizer as any).pool?.usable ?? false) && !(rasterizer as any).poolBroken;
    rasterizer.dispose();
    return {ms, frames, poolUsable};
}

let failed = false;
const passes = [
    ["unlit", false, false, false],
    ["lit", true, false, false],
    ["lit+textured", true, true, false],
    ["lit+textured+halfblock", true, true, true],
] as const;
for (const [label, lit, textured, halfBlock] of passes) {
    const threaded = renderAll({workerCount: 3, threadTriangleThreshold: 1, lit, textured, halfBlock});
    const sync = renderAll({workerCount: 0, threadTriangleThreshold: Number.MAX_SAFE_INTEGER, lit, textured, halfBlock});

    let identical = 0;
    let bytes = 0;
    for (let f = 0; f < FRAMES; f++) {
        if (threaded.frames[f] === sync.frames[f]) identical++;
        bytes += sync.frames[f].length;
    }

    console.log(`[${label}] threaded: ${(threaded.ms / FRAMES).toFixed(3)} ms/frame | sync: ${(sync.ms / FRAMES).toFixed(3)} ms/frame | ${(bytes / FRAMES).toFixed(0)} bytes/frame`);
    console.log(`[${label}] identical frames: ${identical}/${FRAMES} | pool survived threaded run: ${threaded.poolUsable}`);

    if (identical !== FRAMES) {
        console.error(`THREADING MISMATCH [${label}]: threaded output differs from single-threaded output`);
        failed = true;
    }
    if (!threaded.poolUsable) {
        console.error(`THREADING FAILURE [${label}]: pool broke during the threaded run (fell back to sync)`);
        failed = true;
    }
}

pool?.dispose();
if (failed) process.exit(1);
console.log("threading OK");

