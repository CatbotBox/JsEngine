import type {DebugWorld} from "../../src/engine/core";
import {joinPath, normalizePath} from "../../src/engine/platform";
import type {FileSource, FileStat} from "../../src/engine/platform";
import {launchSwarm} from "../../demo/swarm/launch/swarmLaunch";
import {installCellRenderingSwarm} from "../../demo/swarm/launch/cellRendering";
import {installPixelRenderingSwarm} from "../../demo/swarm/launch/pixelRendering";
import {launchDemo2d} from "../../demo/2d/launch/demo2dLaunch";
import {installCellRendering2d} from "../../demo/2d/launch/cellRendering";
import {installPixelRendering2d} from "../../demo/2d/launch/pixelRendering";
import {DEMO_3D_PROJECT_DIRECTORY, launchDemo3d} from "../../demo/3d/launch/demo3dLaunch";
import {DEMO_3D_TUNING_FILE} from "../../demo/3d/modelCatalog";
import {installCellRendering3d} from "../../demo/3d/launch/cellRendering";
import {installPixelRendering3d} from "../../demo/3d/launch/pixelRendering";

export type HashedDemo = "swarm" | "2d" | "3d";
export type HashedBackend = "cells" | "pixels";

export interface DemoFrameHashLaunch {
    readonly demo: HashedDemo;
    readonly backend: HashedBackend;
    readonly world: DebugWorld;
    quit(): void;
}

export const SWARM_FRAME_HASH_SEED = 20261116;
export const DEMO_3D_FRAME_HASH_MODEL_PREFABS: readonly string[] = ["prefabs/models/cube.prefab.json", "prefabs/models/blender_monkey.prefab.json"];

interface ModelEntryJson {
    readonly prefab?: {readonly path?: unknown} | null;
}

interface TuningDocumentJson {
    readonly fields: {models: ModelEntryJson[]};
}

const TUNING_SITE_PATH = normalizePath(joinPath(DEMO_3D_PROJECT_DIRECTORY, DEMO_3D_TUNING_FILE));

function frameHashTuningText(text: string): string {
    const document = JSON.parse(text) as TuningDocumentJson;
    const models = document.fields.models;
    document.fields.models = DEMO_3D_FRAME_HASH_MODEL_PREFABS.map(path => {
        const entry = models.find(model => model.prefab?.path === path);
        if (entry === undefined) throw new Error(`${TUNING_SITE_PATH} lists no ${path}, which the 3D frame hash script spawns`);
        return entry;
    });
    return JSON.stringify(document);
}

class Demo3dFrameHashFiles implements FileSource {
    public write?: (path: string, bytes: Uint8Array) => void;

    public constructor(private readonly files: FileSource) {
        const write = files.write;
        if (write !== undefined) this.write = (path, bytes) => write.call(files, path, bytes);
    }

    public readText(path: string): string {
        const text = this.files.readText(path);
        return normalizePath(path) === TUNING_SITE_PATH ? frameHashTuningText(text) : text;
    }

    public readBytes(path: string): Uint8Array {
        return normalizePath(path) === TUNING_SITE_PATH ? new TextEncoder().encode(this.readText(path)) : this.files.readBytes(path);
    }

    public exists(path: string): boolean {
        return this.files.exists(path);
    }

    public stat(path: string): FileStat {
        return this.files.stat!(path);
    }
}

export function demoFrameHashFiles(demo: HashedDemo, files: FileSource): FileSource {
    return demo === "3d" ? new Demo3dFrameHashFiles(files) : files;
}

async function startSwarm(launch: DemoFrameHashLaunch): Promise<void> {
    await launchSwarm(launch.world, {
        renderBackend: launch.backend,
        installRendering: launch.backend === "cells" ? installCellRenderingSwarm : installPixelRenderingSwarm,
        seed: SWARM_FRAME_HASH_SEED,
        quit: () => launch.quit(),
    });
}

async function startDemo2d(launch: DemoFrameHashLaunch): Promise<void> {
    await launchDemo2d(launch.world, {
        renderBackend: launch.backend,
        installRendering: launch.backend === "cells" ? installCellRendering2d : installPixelRendering2d,
        quit: () => launch.quit(),
    });
}

async function startDemo3d(launch: DemoFrameHashLaunch): Promise<void> {
    await launchDemo3d(launch.world, {
        renderBackend: launch.backend,
        installRendering: launch.backend === "cells" ? installCellRendering3d : installPixelRendering3d,
        quit: () => launch.quit(),
    });
}

export async function startDemoForFrameHashes(launch: DemoFrameHashLaunch): Promise<void> {
    switch (launch.demo) {
        case "swarm":
            await startSwarm(launch);
            return;
        case "2d":
            await startDemo2d(launch);
            return;
        case "3d":
            await startDemo3d(launch);
            return;
    }
}
