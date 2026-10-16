import type {FileSource, FileStat, PreloadEntry} from "../../src/js_engine/platform";
import {joinPath, nodePlatform, normalizePath} from "../../src/js_engine/platform";
import {Mesh} from "../../src/js_engine/rendering/3d";
import type {DemoModel} from "./game";
import {findDemoModels} from "./models";

/** A manifest file: always sized and timestamped from the file on disk. */
export interface ManifestFile extends PreloadEntry {
    readonly size: number;
    readonly mtimeMs: number;
}

/**
 * Everything a host without a file system needs to run the 3D demo: the models the terminal demo
 * would find, and every file loading them reads, at paths relative to the repository root.
 */
export interface Demo3dManifest {
    readonly models: readonly DemoModel[];
    readonly files: readonly ManifestFile[];
}

/** Node files under `root`, addressed by root-relative paths; records which paths are read and which only stat'ed. */
export class RecordingFileSource implements FileSource {
    public readonly read = new Set<string>();
    public readonly statted = new Set<string>();
    private readonly files = nodePlatform().files;

    public constructor(private readonly root: string, private readonly writable: boolean = false) {
        if (writable) this.write = (path, bytes) => this.files.write!(this.resolve(path), bytes);
    }

    public write?: (path: string, bytes: Uint8Array) => void;

    public readBytes(path: string): Uint8Array {
        this.read.add(normalizePath(path));
        return this.files.readBytes(this.resolve(path));
    }

    public readText(path: string): string {
        this.read.add(normalizePath(path));
        return this.files.readText(this.resolve(path));
    }

    public exists(path: string): boolean {
        return this.files.exists(this.resolve(path));
    }

    public stat(path: string): FileStat {
        this.statted.add(normalizePath(path));
        return this.files.stat!(this.resolve(path));
    }

    private resolve(path: string): string {
        return joinPath(this.root, path);
    }
}

/**
 * Loads every model twice through node's files: once allowed to write, so each `.meshcache` is
 * (re)built if it is missing or stale, then read-only, recording what that load touches. Files it
 * reads are fetched by the browser; an obj it only stat'ed (its mesh cache was valid) is listed
 * stat-only, so the page never downloads it. The loads use the game's options, so the caches hold
 * the same detail levels the game asks for.
 */
export function buildDemo3dManifest(root: string): Demo3dManifest {
    const inflate = nodePlatform().inflate;
    const models = findDemoModels(root).map(model => ({name: model.name, path: normalizePath(model.path)}));
    const writable = new RecordingFileSource(root, true);
    const recorder = new RecordingFileSource(root);
    for (const model of models) {
        Mesh.fromFile(model.path, {files: writable, inflate});
        Mesh.fromFile(model.path, {files: recorder, inflate});
    }
    const paths = new Set([...recorder.read, ...recorder.statted]);
    const files = [...paths].sort().map((path): ManifestFile => {
        const {size, mtimeMs} = recorder.stat(path);
        return recorder.read.has(path) ? {path, size, mtimeMs} : {path, size, mtimeMs, statOnly: true};
    });
    return {models, files};
}
