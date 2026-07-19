/**
 * Headless benchmark for the console 3D render pass.
 * Renders N frames of each demo mesh into a ScreenBuffer (no TTY needed)
 * and reports ms/frame for the raster stage and the flush stage.
 *
 * Run: bunx tsx benchmark/raster3d.ts
 */
import {Console3DRenderPassSystem} from "../src/js_engine/rendering/console/3d/console3DRenderPassSystem";
import {ScreenBuffer} from "../src/js_engine/rendering/console/consoleScreenBuffer";
import {Mesh} from "../src/js_engine/rendering/3d/mesh";
import {LocalToWorld} from "../src/js_engine/translation";
import {ScreenSize} from "../src/js_engine/rendering/screenSize";
import {FieldOfView} from "../src/js_engine/rendering/3d/fieldOfView";
import {ConsoleCellRatio} from "../src/js_engine/rendering/consoleCellRatio";
import {Quaternions} from "../src/js_engine/math/quaternions";
import {Ansi} from "../src/js_engine/rendering/console/ansi";

const WIDTH = 240;
const HEIGHT = 64;
const FRAMES = 120;

const screenSize = new ScreenSize();
screenSize.x = WIDTH;
screenSize.y = HEIGHT;

const fov = new FieldOfView();
const cellRatio = new ConsoleCellRatio();
const backgroundChar = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

const cameraTransform = new LocalToWorld();
const invertedCameraMatrix = LocalToWorld.invertAffine(cameraTransform.matrix);

const meshes: [string, Mesh][] = [
    ["cube", Mesh.fromFile("./demo/3d/cube.obj")],
    ["monkey", Mesh.fromFile("./demo/3d/blender_monkey.obj")],
];
// Heavy mesh, not checked into the repo — used when present.
if (require("fs").existsSync("./demo/3d/indoor plant_02.obj")) {
    meshes.push(["plant", Mesh.fromFile("./demo/3d/indoor plant_02.obj")]);
}

// The system keeps drawMesh private; benchmarks reach in on purpose.
const drawMesh: (
    screenBuffer: ScreenBuffer,
    mesh: Mesh,
    localToWorld: LocalToWorld,
    invertedCameraMatrix: Float32Array,
    fov: FieldOfView,
    screenSize: ScreenSize,
    cellRatio: ConsoleCellRatio,
) => void = (Console3DRenderPassSystem as any).drawMesh?.bind(Console3DRenderPassSystem)
    ?? (Console3DRenderPassSystem as any).drawMeshForBenchmark?.bind(Console3DRenderPassSystem);

if (!drawMesh) throw new Error("could not find drawMesh entry point on Console3DRenderPassSystem");

async function bench(name: string, mesh: Mesh): Promise<void> {
    const screenBuffer = new ScreenBuffer();
    const transform = new LocalToWorld();

    let rasterMs = 0;
    let flushMs = 0;
    let sink = 0;

    for (let frame = 0; frame < FRAMES; frame++) {
        // rotate + translate so every frame differs (no identical-frame skips)
        const quat = Quaternions.eulerToQuat([frame * 0.05, frame * 0.03, 0]);
        LocalToWorld.fromTRS(transform.matrix, [0, 0, 8], quat as any, [3, 3, 3]);

        screenBuffer.render({screenSize} as any, backgroundChar);

        const t0 = performance.now();
        drawMesh(screenBuffer, mesh, transform, invertedCameraMatrix, fov, screenSize, cellRatio);
        // if the new implementation rasterizes asynchronously it must still be
        // synchronous by the time drawMesh returns; flush right after.
        const t1 = performance.now();
        const out = screenBuffer.flush();
        const t2 = performance.now();

        sink += out.length;
        rasterMs += t1 - t0;
        flushMs += t2 - t1;
    }

    console.log(
        `${name.padEnd(8)} tris=${String(mesh.triangleCount).padStart(6)} | ` +
        `raster ${(rasterMs / FRAMES).toFixed(3)} ms/frame | ` +
        `flush ${(flushMs / FRAMES).toFixed(3)} ms/frame | ` +
        `total ${((rasterMs + flushMs) / FRAMES).toFixed(3)} ms/frame | ` +
        `frame chars ~${Math.round(sink / FRAMES)}`
    );
}

(async () => {
    console.log(`screen ${WIDTH}x${HEIGHT}, ${FRAMES} frames per mesh`);
    for (const [name, mesh] of meshes) {
        await bench(name, mesh);
    }
    // allow worker pools (new impl) to shut down
    const dispose = (Console3DRenderPassSystem as any).disposeRasterPool;
    if (dispose) dispose.call(Console3DRenderPassSystem);
})();
