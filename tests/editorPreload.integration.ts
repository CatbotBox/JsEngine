import {join, resolve} from "path";
import {App} from "../src/engine/core";
import {MemoryTerminal} from "../src/engine/testing/memoryPlatform";
import {Mesh} from "../src/engine/rendering/3d";
import {AnsiCellPresenter, nodePlatform} from "../src/hosts/terminal";
import {RecordingFileSource} from "../src/toolchain/build/projectAssets";
import {DEMO_3D_PROJECT, startCellsDemo} from "./support/demoProjects";

const ROOT = resolve(__dirname, "..");
const PROJECT_FOLDER = join(ROOT, DEMO_3D_PROJECT.directory);
const MESH_EXTENSION = ".obj";
const ON_DEMAND_MESH = "models/bugatti/bugatti.obj";
const UP_FRONT_MESHES: readonly string[] = ["models/cube/cube.obj", "models/blender_monkey/blender_monkey.obj"];
const SIZE = {columns: 80, rows: 24};
const BYTES_PER_MB = 1024 * 1024;
const MB_DECIMALS = 1;

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
function expect(condition: boolean, label: string): void {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

function megabytes(bytes: number): string {
    return `${(bytes / BYTES_PER_MB).toFixed(MB_DECIMALS)} MB`;
}

class EditorPreloadRecorder {
    public readonly paths: string[] = [];
    private readonly platform = nodePlatform();
    private readonly files = new RecordingFileSource(PROJECT_FOLDER, this.platform.files);

    public get bytesRead(): number {
        return [...this.files.read].reduce((sum, path) => sum + this.files.stat(path).size, 0);
    }

    public preload = async (paths: readonly string[]): Promise<void> => {
        for (const path of new Set(paths)) {
            this.paths.push(path);
            if (path.toLowerCase().endsWith(MESH_EXTENSION)) Mesh.fromFile(path, {files: this.files, inflate: this.platform.inflate});
            else if (this.files.exists(path)) this.files.readBytes(path);
        }
    };
}

async function main(): Promise<void> {
    const recorder = new EditorPreloadRecorder();
    const platform = nodePlatform();
    const world = new App({platform}).createDebugWorld();
    await startCellsDemo(world, new AnsiCellPresenter(new MemoryTerminal(SIZE)), DEMO_3D_PROJECT, {preload: recorder.preload});
    world.stop();
    const meshes = recorder.paths.filter(path => path.toLowerCase().endsWith(MESH_EXTENSION));
    log(`demo/3d start preloads ${recorder.paths.length} files, reading ${megabytes(recorder.bytesRead)}; meshes: ${meshes.join(", ")}`);
    expect(!meshes.includes(ON_DEMAND_MESH), `the on-demand model's mesh ${ON_DEMAND_MESH} is not preloaded`);
    for (const mesh of UP_FRONT_MESHES) expect(meshes.includes(mesh), `the up-front model mesh ${mesh} is preloaded`);
    if (failures > 0) {
        console.error(`${failures} editor preload failures`);
        process.exit(1);
    }
    log("editor preload OK");
}

void main();
