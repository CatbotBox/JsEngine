import type {DebugWorld} from "../../src/engine/core";
import type {CellPresenter} from "../../src/backends/cells";
import type {PixelPresenter} from "../../src/backends/pixels";
import {joinPath, normalizePath} from "../../src/engine/platform";
import type {FileSource, FileStat} from "../../src/engine/platform";
import {SWARM_CONFIG_FILE} from "../../demo/swarm/config";
import {DEMO_3D_CONFIG_FILE} from "../../demo/3d/modelCatalog";
import {DEMO_2D_PROJECT, DEMO_3D_PROJECT, startCellsDemo, startPixelsDemo, SWARM_PROJECT} from "./demoProjects";
import type {DemoProject} from "./demoProjects";

export type HashedDemo = "swarm" | "2d" | "3d";
export type HashedBackend = "cells" | "pixels";

export type HashedOutput =
    | {readonly backend: "cells", readonly presenter: CellPresenter}
    | {readonly backend: "pixels", readonly presenter: PixelPresenter};

export interface DemoFrameHashLaunch {
    readonly demo: HashedDemo;
    readonly output: HashedOutput;
    readonly world: DebugWorld;
}

export const SWARM_FRAME_HASH_SEED = 20261116;
export const DEMO_3D_FRAME_HASH_MODEL_PREFABS: readonly string[] = ["prefabs/cube.prefab.json", "prefabs/blender_monkey.prefab.json"];

interface ModelEntryJson {
    readonly prefab?: {readonly path?: unknown} | null;
}

interface Demo3dConfigDocumentJson {
    readonly fields: {models: ModelEntryJson[]};
}

interface SwarmConfigDocumentJson {
    readonly fields: {randomSeed: number | null};
}

type TextOverlay = (text: string) => string;

const DEMO_3D_CONFIG_SITE_PATH = normalizePath(joinPath(DEMO_3D_PROJECT.directory, DEMO_3D_CONFIG_FILE));
const SWARM_CONFIG_SITE_PATH = normalizePath(joinPath(SWARM_PROJECT.directory, SWARM_CONFIG_FILE));
const HASHED_PROJECTS: Readonly<Record<HashedDemo, DemoProject>> = {swarm: SWARM_PROJECT, "2d": DEMO_2D_PROJECT, "3d": DEMO_3D_PROJECT};

function frameHashDemo3dConfigText(text: string): string {
    const document = JSON.parse(text) as Demo3dConfigDocumentJson;
    const models = document.fields.models;
    document.fields.models = DEMO_3D_FRAME_HASH_MODEL_PREFABS.map(path => {
        const entry = models.find(model => model.prefab?.path === path);
        if (entry === undefined) throw new Error(`${DEMO_3D_CONFIG_SITE_PATH} lists no ${path}, which the 3D frame hash script spawns`);
        return entry;
    });
    return JSON.stringify(document);
}

function seededSwarmConfigText(text: string, seed: number): string {
    const document = JSON.parse(text) as SwarmConfigDocumentJson;
    document.fields.randomSeed = seed;
    return JSON.stringify(document);
}

class OverlaidFileSource implements FileSource {
    public write?: (path: string, bytes: Uint8Array) => void;

    public constructor(private readonly files: FileSource, private readonly overlays: ReadonlyMap<string, TextOverlay>) {
        const write = files.write;
        if (write !== undefined) this.write = (path, bytes) => write.call(files, path, bytes);
    }

    public readText(path: string): string {
        const text = this.files.readText(path);
        const overlay = this.overlays.get(normalizePath(path));
        return overlay === undefined ? text : overlay(text);
    }

    public readBytes(path: string): Uint8Array {
        return this.overlays.has(normalizePath(path)) ? new TextEncoder().encode(this.readText(path)) : this.files.readBytes(path);
    }

    public exists(path: string): boolean {
        return this.files.exists(path);
    }

    public stat(path: string): FileStat {
        return this.files.stat!(path);
    }
}

export function seededSwarmFiles(files: FileSource, seed: number): FileSource {
    return new OverlaidFileSource(files, new Map([[SWARM_CONFIG_SITE_PATH, text => seededSwarmConfigText(text, seed)]]));
}

export function demoFrameHashFiles(demo: HashedDemo, files: FileSource): FileSource {
    switch (demo) {
        case "swarm":
            return seededSwarmFiles(files, SWARM_FRAME_HASH_SEED);
        case "2d":
            return files;
        case "3d":
            return new OverlaidFileSource(files, new Map([[DEMO_3D_CONFIG_SITE_PATH, frameHashDemo3dConfigText]]));
    }
}

export async function startDemoForFrameHashes(launch: DemoFrameHashLaunch): Promise<void> {
    const project = HASHED_PROJECTS[launch.demo];
    const output = launch.output;
    if (output.backend === "cells") await startCellsDemo(launch.world, output.presenter, project);
    else await startPixelsDemo(launch.world, output.presenter, project);
}
