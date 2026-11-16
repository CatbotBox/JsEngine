import type {AssetLoadOptions, FileSource, FileStat} from "../../src/engine/platform";
import {directoryFileSource, joinPath, normalizePath} from "../../src/engine/platform";
import {Mesh} from "../../src/engine/rendering/3d";
import {ComponentSchemaRegistry, DataAssets, MESH_ASSET_TYPE_NAME, registerEngineComponentSchemas, sceneAssetPaths} from "../../src/engine/scene";
import {DEMO_3D_TUNING_FILE, prefabRootName, requireModelPrefab} from "./modelCatalog";
import {registerGeneratedSchemas} from "./schemas.generated";
import {Demo3dTuning} from "./tuning";

export interface ManifestFile {
    readonly path: string;
    readonly size: number;
    readonly mtimeMs: number;
    readonly statOnly?: boolean;
    readonly lazy?: boolean;
    readonly gzipParts?: readonly number[];
}

export interface ManifestModel {
    readonly name: string;
    readonly path: string;
    readonly meshes: readonly string[];
    readonly files: readonly string[];
}

export interface Demo3dManifest {
    readonly models: readonly ManifestModel[];
    readonly files: readonly ManifestFile[];
}

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

function demo3dSchemaRegistry(): ComponentSchemaRegistry {
    const registry = new ComponentSchemaRegistry();
    registerEngineComponentSchemas(registry);
    registerGeneratedSchemas(registry);
    return registry;
}

function loadTuning(root: string, projectDirectory: string, base: AssetLoadOptions, registry: ComponentSchemaRegistry): Demo3dTuning {
    const files = directoryFileSource(new RecordingFileSource(root, base.files), projectDirectory);
    return new DataAssets(registry, {files, inflate: base.inflate}).load(DEMO_3D_TUNING_FILE, Demo3dTuning);
}

export function buildDemo3dManifest(root: string, projectDirectory: string, base: AssetLoadOptions): Demo3dManifest {
    const inflate = base.inflate;
    const registry = demo3dSchemaRegistry();
    const writable = new RecordingFileSource(root, base.files, WRITABLE);
    const stats = new RecordingFileSource(root, base.files);
    const recorded = loadTuning(root, projectDirectory, base, registry).models.map((entry, index) => {
        const prefab = requireModelPrefab(entry, index);
        const meshes = sceneAssetPaths(prefab.document, registry)
            .filter(reference => reference.kind === MESH_ASSET_TYPE_NAME)
            .map(reference => normalizePath(joinPath(projectDirectory, reference.path)));
        for (const mesh of meshes) Mesh.fromFile(mesh, {files: writable, inflate});
        const recorder = new RecordingFileSource(root, base.files);
        for (const mesh of meshes) Mesh.fromFile(mesh, {files: recorder, inflate});
        return {model: {name: prefabRootName(prefab), path: prefab.sourcePath, meshes}, recorder, lazy: entry.loadOnDemand};
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
