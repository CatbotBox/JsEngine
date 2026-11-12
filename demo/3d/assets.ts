import type {AssetLoadOptions, FileSource, FileStat} from "../../src/engine/platform";
import {joinPath, normalizePath} from "../../src/engine/platform";
import {Mesh} from "../../src/engine/rendering/3d";
import type {DemoModel} from "./game";
import {findDemoModels} from "./models";

export interface ManifestFile {
    readonly path: string;
    readonly size: number;
    readonly mtimeMs: number;
    readonly statOnly?: boolean;
    readonly lazy?: boolean;
    readonly gzipParts?: readonly number[];
}

export interface ManifestModel extends DemoModel {
    readonly files: readonly string[];
}

export interface Demo3dManifest {
    readonly models: readonly ManifestModel[];
    readonly files: readonly ManifestFile[];
}

export interface Demo3dManifestOptions {
    readonly lazyModelBytes?: number;
}

export const DEFAULT_LAZY_MODEL_BYTES = 16 * 1024 * 1024;
const WRITABLE = true;

export class RecordingFileSource implements FileSource {
    public readonly read = new Set<string>();
    public readonly statted = new Set<string>();

    public constructor(private readonly root: string, private readonly files: FileSource, private readonly writable: boolean = false) {
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

export function buildDemo3dManifest(root: string, base: AssetLoadOptions, options: Demo3dManifestOptions = {}): Demo3dManifest {
    const lazyModelBytes = options.lazyModelBytes ?? DEFAULT_LAZY_MODEL_BYTES;
    const inflate = base.inflate;
    const writable = new RecordingFileSource(root, base.files, WRITABLE);
    const stats = new RecordingFileSource(root, base.files);
    const recorded = findDemoModels(root).map(found => {
        const model = {name: found.name, path: normalizePath(found.path)};
        Mesh.fromFile(model.path, {files: writable, inflate});
        const recorder = new RecordingFileSource(root, base.files);
        Mesh.fromFile(model.path, {files: recorder, inflate});
        const readBytes = [...recorder.read].reduce((sum, path) => sum + stats.stat(path).size, 0);
        return {model, recorder, lazy: readBytes > lazyModelBytes};
    });
    const read = new Set(recorded.flatMap(({recorder}) => [...recorder.read]));
    const eagerRead = new Set(recorded.filter(({lazy}) => !lazy).flatMap(({recorder}) => [...recorder.read]));
    const paths = new Set(recorded.flatMap(({recorder}) => [...recorder.read, ...recorder.statted]));
    const files = [...paths].sort().map((path): ManifestFile => {
        const {size, mtimeMs} = stats.stat(path);
        if (!read.has(path)) return {path, size, mtimeMs, statOnly: true};
        return eagerRead.has(path) ? {path, size, mtimeMs} : {path, size, mtimeMs, lazy: true};
    });
    const models = recorded.map(({model, recorder}): ManifestModel => ({
        ...model,
        files: [...new Set([...recorder.read, ...recorder.statted])].sort(),
    }));
    return {models, files};
}
