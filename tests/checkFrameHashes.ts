import {createHash} from "crypto";
import {existsSync, readFileSync, writeFileSync} from "fs";
import {join, relative, resolve} from "path";
import {Mesh} from "../src/js_engine/rendering/3d/mesh";
import {ViewSpaceMesh} from "../src/js_engine/rendering/3d/viewSpaceMesh";
import {SceneLights, VertexLighting} from "../src/js_engine/rendering/3d/lighting";
import {MeshRasterizer} from "../src/js_engine/rendering/3d/software";
import {ConsoleCellResolveTarget} from "../src/js_engine/rendering/console/3d/consoleCellResolveTarget";
import {ScreenBuffer} from "../src/js_engine/rendering/console/consoleScreenBuffer";
import {ScreenSize} from "../src/js_engine/rendering/screenSize";
import {LocalToWorld} from "../src/js_engine/translation/localToWorld";
import {Quaternions} from "../src/js_engine/math/quaternions";
import {fromFloat32Array, Vec3} from "../src/js_engine/math/types/vec";

const ROOT = resolve(__dirname, "..");
const BASELINE_PATH = join(__dirname, "frameHashes.baseline.txt");
const UPDATE_BASELINE = process.argv.includes("--update-baseline");
const MESH_PATH = join(ROOT, "demo", "3d", "blender_monkey.obj");

const WIDTH = 200, HEIGHT = 60, FRAMES = 30;
const HALF_FOV_RAD = Math.PI / 6;
const CELL_ASPECT_RATIO = 2;
const COLOR_QUANT_MASK = 0xFCFCFC;
const MONKEY_RGB = 0xF7A44F;
const MONKEY_SCALE = 3;
const PITCH_RAD_PER_FRAME = 0.05, YAW_RAD_PER_FRAME = 0.03;
const UNCLIPPED_FRAMES = 15, UNCLIPPED_Z = 8, NEAR_PLANE_CLIPPED_Z = 0.6;
const MAX_DEPTH_FADE = 15;

interface FrameHash {
    readonly label: string;
    readonly bytes: number;
    readonly sha1: string;
}

function renderFrameHashes(): FrameHash[] {
    const screenSize = new ScreenSize();
    screenSize.x = WIDTH;
    screenSize.y = HEIGHT;
    const mesh = Mesh.fromFile(MESH_PATH);
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

    const results: FrameHash[] = [];
    for (const [lit, halfBlock] of [[false, false], [true, false], [true, true]] as const) {
        for (const supersample of [1, 2]) {
            const rasterizer = new MeshRasterizer();
            const target = new ConsoleCellResolveTarget();
            const hash = createHash("sha1");
            let bytes = 0;
            for (let f = 0; f < FRAMES; f++) {
                const transform = new LocalToWorld();
                const quat = Quaternions.eulerToQuat(Vec3.alloc(f * PITCH_RAD_PER_FRAME, f * YAW_RAD_PER_FRAME, 0));
                LocalToWorld.fromTRS(transform.matrix, Vec3.alloc(0, 0, f < UNCLIPPED_FRAMES ? UNCLIPPED_Z : NEAR_PLANE_CLIPPED_Z), quat, Vec3.alloc(MONKEY_SCALE, MONKEY_SCALE, MONKEY_SCALE));
                const modelView = LocalToWorld.mul(invCam, transform.matrix) as unknown as Float32Array;
                const buffer = new ScreenBuffer();
                buffer.beginFrame({screenSize} as any, " ");
                target.begin(buffer, {colorQuantMask: COLOR_QUANT_MASK});
                rasterizer.beginFrame(target, WIDTH, HEIGHT, {
                    maxDepthFade: MAX_DEPTH_FADE, colorQuantMask: COLOR_QUANT_MASK, supersample, workerCount: 0,
                    threadTriangleThreshold: Number.MAX_SAFE_INTEGER, threadAreaThreshold: Number.POSITIVE_INFINITY, textures: true, halfBlock,
                });
                if (lit) {
                    const viewMesh = viewSpaceMesh.transformFrom(mesh, modelView, LocalToWorld.normalMatrix3(fromFloat32Array<16>(modelView), normalMatrix));
                    rasterizer.addViewSpaceMesh(mesh, viewMesh, focal, CELL_ASPECT_RATIO, MONKEY_RGB, vertexLighting.shade(viewMesh, MONKEY_RGB));
                } else {
                    rasterizer.addMesh(mesh, modelView, focal, CELL_ASPECT_RATIO, MONKEY_RGB);
                }
                rasterizer.endFrame();
                const frame = buffer.flush();
                bytes += frame.length;
                hash.update(frame);
            }
            rasterizer.dispose();
            const label = `${lit ? "lit" : "unlit"}${halfBlock ? " halfblock" : ""} supersample=${supersample}`;
            results.push({label, bytes, sha1: hash.digest("hex")});
        }
    }
    return results;
}

function baselineLine(result: FrameHash): string {
    return `${result.label} sha1=${result.sha1}`;
}

function readBaseline(): Map<string, string> {
    const baseline = new Map<string, string>();
    if (!existsSync(BASELINE_PATH)) return baseline;
    for (const line of readFileSync(BASELINE_PATH, "utf8").split(/\r?\n/)) {
        const match = /^(.*) sha1=([0-9a-f]+)$/.exec(line.trim());
        if (match !== null) baseline.set(match[1], match[2]);
    }
    return baseline;
}

const results = renderFrameHashes();
const baselineName = relative(ROOT, BASELINE_PATH).replace(/\\/g, "/");

if (UPDATE_BASELINE) {
    writeFileSync(BASELINE_PATH, results.map(baselineLine).join("\n") + "\n");
    for (const result of results) console.log(`${baselineLine(result)} bytes=${result.bytes}`);
    console.log(`wrote ${baselineName}`);
} else {
    const baseline = readBaseline();
    const mismatches: string[] = [];
    for (const result of results) {
        const expected = baseline.get(result.label);
        const matches = expected === result.sha1;
        console.log(`${matches ? "ok      " : "MISMATCH"} ${baselineLine(result)} bytes=${result.bytes}`);
        if (!matches) mismatches.push(`${result.label}: expected ${expected ?? "(no baseline entry)"}, got ${result.sha1}`);
    }
    if (mismatches.length > 0) {
        console.error(`${mismatches.length} frame hash(es) differ from ${baselineName}:`);
        for (const mismatch of mismatches) console.error(`  ${mismatch}`);
        console.error("If the change is intended, rerun with --update-baseline.");
        process.exit(1);
    }
    console.log(`all ${results.length} frame hashes match ${baselineName}`);
}
