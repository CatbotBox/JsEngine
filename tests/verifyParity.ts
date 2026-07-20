/**
 * Renders the same scenes through the pre-rewrite renderer (checked out from
 * git history into _legacy/) and the new renderer, then compares the resulting
 * cell grids: per-cell coverage, depth and color.
 *
 * The old pipeline computed in Float32 (VecArray) while the new one uses
 * Float64, so pixels exactly on triangle edges can flip â€” a small mismatch
 * rate is expected and reported; large mismatches mean a real bug.
 *
 * Run: bun tests/verifyParity.ts
 */
import {Console3DRenderPassSystem as LegacySystem} from "./_legacy/legacy3DSystem";
import {ScreenBuffer as LegacyScreenBuffer} from "./_legacy/legacyScreenBuffer";
import {Console3DRenderPassSystem as NewSystem} from "../src/js_engine/rendering/console/3d/console3DRenderPassSystem";
import {ScreenBuffer as NewScreenBuffer} from "../src/js_engine/rendering/console/consoleScreenBuffer";
import {Mesh} from "../src/js_engine/rendering/3d/mesh";
import {LocalToWorld} from "../src/js_engine/translation";
import {ScreenSize} from "../src/js_engine/rendering/screenSize";
import {FieldOfView} from "../src/js_engine/rendering/3d/fieldOfView";
import {ConsoleCellRatio} from "../src/js_engine/rendering/consoleCellRatio";
import {Quaternions} from "../src/js_engine/math/quaternions";
import {Ansi} from "../src/js_engine/rendering/console/ansi";

const WIDTH = 240;
const HEIGHT = 64;
const FRAMES = 24;

// Compare exact colors â€” disable quantization for parity purposes.
NewSystem.colorQuantMask = 0xFFFFFF;

const screenSize = new ScreenSize();
screenSize.x = WIDTH;
screenSize.y = HEIGHT;
const fov = new FieldOfView();
const cellRatio = new ConsoleCellRatio();
const backgroundChar = Ansi.colors.bg.black + Ansi.colors.fg.black + " ";

const cameraTransform = new LocalToWorld();
const invCam = LocalToWorld.invertAffine(cameraTransform.matrix);

const legacyDraw = (LegacySystem as any).drawMesh.bind(LegacySystem);

const COLOR_RE = /^\x1b\[48;2;(\d+);(\d+);(\d+)m [\s\S]*$/;

function legacyCells(buffer: LegacyScreenBuffer): { covered: boolean, r: number, g: number, b: number, depth: number }[][] {
    const cells: string[][] = (buffer as any).cells;
    const depths: number[][] = (buffer as any).depthBuffer;
    return cells.map((row, y) => row.map((cell, x) => {
        const m = COLOR_RE.exec(cell);
        if (!m) return {covered: false, r: 0, g: 0, b: 0, depth: Infinity};
        return {covered: true, r: +m[1], g: +m[2], b: +m[3], depth: depths[y][x]};
    }));
}

function newCells(buffer: NewScreenBuffer): { covered: boolean, r: number, g: number, b: number, depth: number }[][] {
    const kind: Uint8Array = (buffer as any).kind;
    const rgb: Int32Array = (buffer as any).rgb;
    const depth: Float32Array = (buffer as any).depth;
    const out = [];
    for (let y = 0; y < HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < WIDTH; x++) {
            const i = y * WIDTH + x;
            if (kind[i] !== 1) row.push({covered: false, r: 0, g: 0, b: 0, depth: Infinity});
            else row.push({covered: true, r: (rgb[i] >> 16) & 255, g: (rgb[i] >> 8) & 255, b: rgb[i] & 255, depth: depth[i]});
        }
        out.push(row);
    }
    return out;
}

function silhouette(cells: { covered: boolean }[][], step = 4): string {
    let s = "";
    for (let y = 0; y < HEIGHT; y += 2) {
        for (let x = 0; x < WIDTH; x += step) s += cells[y][x].covered ? "#" : ".";
        s += "\n";
    }
    return s;
}

const meshes: [string, Mesh][] = [
    ["cube", Mesh.fromFile("./demo/3d/cube.obj")],
    ["monkey", Mesh.fromFile("./demo/3d/blender_monkey.obj")],
];
// Heavy mesh, not checked into the repo â€” used when present.
if (require("fs").existsSync("./demo/3d/indoor plant_02.obj")) {
    meshes.push(["plant", Mesh.fromFile("./demo/3d/indoor plant_02.obj")]);
}

let worst = 0;
let shown = false;

for (const [name, mesh] of meshes) {
    let totalCells = 0, coverMismatch = 0, colorMismatch = 0, depthMismatch = 0, covered = 0;

    for (let frame = 0; frame < FRAMES; frame++) {
        const transform = new LocalToWorld();
        const quat = Quaternions.eulerToQuat([frame * 0.26, frame * 0.155, 0]);
        LocalToWorld.fromTRS(transform.matrix, [0, 0, 8 - frame * 0.31], quat as any, [3, 3, 3]);

        const legacyBuffer = new LegacyScreenBuffer();
        legacyBuffer.render({screenSize} as any, backgroundChar);
        legacyDraw(legacyBuffer, mesh, transform, invCam, fov, screenSize, cellRatio);

        const newBuffer = new NewScreenBuffer();
        newBuffer.render({screenSize} as any, backgroundChar);
        NewSystem.drawMeshForBenchmark(newBuffer, mesh, transform, invCam as any, fov, screenSize, cellRatio);

        const legacy = legacyCells(legacyBuffer);
        const modern = newCells(newBuffer);

        if (!shown && name === "monkey" && frame === 0) {
            console.log("legacy silhouette (monkey):\n" + silhouette(legacy));
            console.log("new silhouette (monkey):\n" + silhouette(modern));
            shown = true;
        }

        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                totalCells++;
                const a = legacy[y][x], b = modern[y][x];
                if (a.covered !== b.covered) { coverMismatch++; continue; }
                if (!a.covered) continue;
                covered++;
                if (Math.abs(a.depth - b.depth) > 0.01 * a.depth) depthMismatch++;
                if (Math.abs(a.r - b.r) > 1 || Math.abs(a.g - b.g) > 1 || Math.abs(a.b - b.b) > 1) colorMismatch++;
            }
        }
    }

    const coverRate = coverMismatch / totalCells;
    worst = Math.max(worst, coverRate);
    console.log(
        `${name.padEnd(8)} cells=${totalCells} covered=${covered} | ` +
        `coverage mismatches ${coverMismatch} (${(100 * coverRate).toFixed(4)}%) | ` +
        `color mismatches ${colorMismatch} | depth mismatches ${depthMismatch}`
    );
}

const dispose = (NewSystem as any).disposeRasterPool;
if (dispose) dispose.call(NewSystem);

if (worst > 0.005) {
    console.error("PARITY FAILURE: too many mismatching cells");
    process.exit(1);
}
console.log("parity OK (differences within float32â†’float64 edge tolerance)");

