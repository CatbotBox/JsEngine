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
import {Ansi} from "../src/js_engine/rendering/console/ansi";

const WIDTH = 240, HEIGHT = 64, FRAMES = 60;

// Direct pool sanity check first.
let pool: RasterWorkerPool | undefined;
try {
    pool = new RasterWorkerPool(3);
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

function renderAll(config: { workerCount: number, threadTriangleThreshold: number }): { ms: number, frames: string[], poolUsable: boolean } {
    const rasterizer = new MeshRasterizer();
    const frames: string[] = [];
    const start = performance.now();
    for (let f = 0; f < FRAMES; f++) {
        const transform = new LocalToWorld();
        const quat = Quaternions.eulerToQuat([f * 0.05, f * 0.03, 0]);
        LocalToWorld.fromTRS(transform.matrix, [0, 0, 8], quat as any, [3, 3, 3]);
        const modelView = LocalToWorld.mul(invCam, transform.matrix) as Float32Array;

        const buffer = new ScreenBuffer();
        buffer.render({screenSize} as any, backgroundChar);
        rasterizer.beginFrame(buffer, WIDTH, HEIGHT, {
            maxDepthFade: 15,
            colorQuantMask: 0xFFFFFF,
            workerCount: config.workerCount,
            threadTriangleThreshold: config.threadTriangleThreshold,
            threadAreaThreshold: Number.POSITIVE_INFINITY,
        });
        rasterizer.addMesh(mesh, modelView, focal, 2, 0xFFFFFF);
        rasterizer.endFrame();
        frames.push(buffer.flush());
    }
    const ms = performance.now() - start;
    const poolUsable = ((rasterizer as any).pool?.usable ?? false) && !(rasterizer as any).poolBroken;
    rasterizer.dispose();
    return {ms, frames, poolUsable};
}

const threaded = renderAll({workerCount: 3, threadTriangleThreshold: 1});
const sync = renderAll({workerCount: 0, threadTriangleThreshold: Number.MAX_SAFE_INTEGER});

let identical = 0;
for (let f = 0; f < FRAMES; f++) {
    if (threaded.frames[f] === sync.frames[f]) identical++;
}

console.log(`threaded: ${(threaded.ms / FRAMES).toFixed(3)} ms/frame | sync: ${(sync.ms / FRAMES).toFixed(3)} ms/frame`);
console.log(`identical frames: ${identical}/${FRAMES} | pool survived threaded run: ${threaded.poolUsable}`);

pool?.dispose();
if (identical !== FRAMES) {
    console.error("THREADING MISMATCH: threaded output differs from single-threaded output");
    process.exit(1);
}
if (!threaded.poolUsable) {
    console.error("THREADING FAILURE: pool broke during the threaded run (fell back to sync)");
    process.exit(1);
}
console.log("threading OK");

