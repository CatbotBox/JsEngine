import {existsSync, mkdirSync, readdirSync, writeFileSync} from "fs";
import {dirname, join, relative} from "path";
import {registerBuiltinImageDecoders} from "../../engine/assets/image/builtinDecoders";
import type {AssetLoadOptions, FileSource, FileStat} from "../../engine/platform";
import {joinPath, normalizePath} from "../../engine/platform";
import {Mesh} from "../../engine/rendering/3d";
import {
    assetReferencesOfFields,
    DATA_ASSET_FILE_SUFFIX,
    MESH_ASSET_TYPE_NAME,
    PARENT_COMPONENT_NAME,
    parseDataAssetDocument,
    parseSceneDocument,
    PREFAB_FILE_SUFFIX,
    sceneAssetPaths,
} from "../../engine/scene";
import type {ComponentSchemaRegistry, SceneAssetReference, SceneDocument, SchemaEntry} from "../../engine/scene";
import {SCENE_FILE_SUFFIX} from "../../engine/project/projectManifest";
import {createProjectSchemaRegistry} from "../../engine/project/projectSchemas";
import {EDITOR_SCHEMAS} from "../../editor/world/editorSchemas";
import type {AssetManifestFile, AssetManifestPrefab, ProjectAssetManifest} from "../../hosts/web/webProjectAssets";
import {CliError} from "../cliArguments";
import {GENERATED_FOLDER, GENERATED_SCHEMAS_FILE} from "../projectLayout";
import {compareText, isInside} from "../generate/projectSources";
import {REPO_ROOT} from "../repoPaths";
import {EXTERNAL_ENGINE_IMPORTS, projectBuildDirectory} from "./editorBuild";
import {isWebProjectDataFile} from "./webDistFiles";

const ASSET_SCHEMAS_BUNDLE_FILE = "assetSchemas.js";
const WRITABLE = true;
const BYTES_PER_MB = 1024 * 1024;
export const ON_DEMAND_PREFAB_BYTES = 16 * BYTES_PER_MB;
const NO_SCHEMAS: readonly SchemaEntry[] = [];

interface GeneratedSchemasModule {
    readonly generatedSchemas?: readonly SchemaEntry[];
}
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([".jsengine", "node_modules", GENERATED_FOLDER]);

export class RecordingFileSource implements FileSource {
    public readonly read = new Set<string>();
    public readonly statted = new Set<string>();

    public constructor(private readonly root: string, private readonly files: FileSource, writable: boolean = false) {
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

interface ProjectDocument {
    readonly path: string;
    readonly references: readonly SceneAssetReference[];
    readonly scene?: SceneDocument;
}

interface RecordedFiles {
    readonly read: ReadonlySet<string>;
    readonly statted: ReadonlySet<string>;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isSceneOrPrefab(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith(SCENE_FILE_SUFFIX) || lower.endsWith(PREFAB_FILE_SUFFIX);
}

function isDocument(path: string): boolean {
    return isSceneOrPrefab(path) || path.toLowerCase().endsWith(DATA_ASSET_FILE_SUFFIX);
}

function documentPathsUnder(folder: string, directory: string = folder): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_FOLDERS.has(entry.name) ? [] : documentPathsUnder(folder, path);
        return isDocument(entry.name) ? [relative(folder, path).replace(/\\/g, "/")] : [];
    }).sort(compareText);
}

function isPrefab(document: ProjectDocument): boolean {
    return document.scene !== undefined && document.path.toLowerCase().endsWith(PREFAB_FILE_SUFFIX);
}

function rootEntityName(prefab: SceneDocument, fallback: string): string {
    const root = prefab.entities.find(record => record.components[PARENT_COMPONENT_NAME] === undefined);
    return root?.name ?? fallback;
}

class ProjectAssetRecorder {
    private readonly writable: RecordingFileSource;
    private readonly meshFiles = new Map<string, RecordedFiles>();
    private readonly otherFiles = new Map<string, RecordedFiles>();

    public constructor(
        private readonly root: string,
        private readonly projectDirectory: string,
        private readonly base: AssetLoadOptions,
        private readonly registry: ComponentSchemaRegistry,
        private readonly onDemandPrefabBytes: number,
    ) {
        this.writable = new RecordingFileSource(root, base.files, WRITABLE);
    }

    public manifest(): ProjectAssetManifest {
        const documents = documentPathsUnder(join(this.root, this.projectDirectory)).map(path => this.document(path));
        for (const document of documents) for (const reference of document.references) this.record(reference);
        const files = this.files();
        const sizes = new Map(files.map(file => [file.path, file.statOnly === true ? 0 : file.size]));
        const onDemand = new Set(documents.filter(document => isPrefab(document) && this.fetchedBytes(document, sizes) > this.onDemandPrefabBytes));
        const upFront = new Set(documents.filter(document => !onDemand.has(document)).flatMap(document => this.filesOf(document)));
        const prefabs = documents.filter(isPrefab)
            .map(document => this.prefabEntry(document))
            .filter(prefab => prefab.files.length > 0);
        return {prefabs, files: files.map(file => file.statOnly === true || upFront.has(file.path) ? file : {...file, lazy: true})};
    }

    private filesOf(document: ProjectDocument): string[] {
        return document.references.flatMap(reference => {
            const path = this.sitePath(reference.path);
            const recorded = this.meshFiles.get(path) ?? this.otherFiles.get(path);
            return recorded === undefined ? [] : [...recorded.read, ...recorded.statted];
        });
    }

    private fetchedBytes(document: ProjectDocument, sizes: ReadonlyMap<string, number>): number {
        return [...new Set(this.filesOf(document))].reduce((sum, path) => sum + (sizes.get(path) ?? 0), 0);
    }

    private sitePath(path: string): string {
        return normalizePath(joinPath(this.projectDirectory, path));
    }

    private document(path: string): ProjectDocument {
        try {
            return this.parsedDocument(path);
        } catch (error) {
            throw new Error(`could not read the asset references of ${this.sitePath(path)}: ${describeError(error)}`);
        }
    }

    private parsedDocument(path: string): ProjectDocument {
        const text = this.base.files.readText(joinPath(this.root, this.sitePath(path)));
        if (isSceneOrPrefab(path)) {
            const scene = parseSceneDocument(text);
            return {path, scene, references: sceneAssetPaths(scene, this.registry)};
        }
        const asset = parseDataAssetDocument(text, path);
        const schema = this.registry.resourceByName(asset.type);
        return {path, references: schema === undefined ? [] : assetReferencesOfFields(schema.fields, asset.fields)};
    }

    private record(reference: SceneAssetReference): void {
        const path = this.sitePath(reference.path);
        if (isWebProjectDataFile(path) || this.meshFiles.has(path) || this.otherFiles.has(path)) return;
        if (reference.kind === MESH_ASSET_TYPE_NAME) {
            this.meshFiles.set(path, this.recordMesh(path));
            return;
        }
        const recorder = new RecordingFileSource(this.root, this.base.files);
        if (recorder.exists(path)) recorder.readBytes(path);
        this.otherFiles.set(path, recorder);
    }

    private recordMesh(path: string): RecordedFiles {
        const recorder = new RecordingFileSource(this.root, this.base.files);
        try {
            Mesh.fromFile(path, {files: this.writable, inflate: this.base.inflate});
            Mesh.fromFile(path, {files: recorder, inflate: this.base.inflate});
        } catch (error) {
            throw new Error(`could not load the mesh ${path} that a scene, prefab or data asset names: ${describeError(error)}`);
        }
        return recorder;
    }

    private prefabEntry(document: ProjectDocument): AssetManifestPrefab {
        const meshes = document.references.filter(reference => reference.kind === MESH_ASSET_TYPE_NAME).map(reference => this.sitePath(reference.path));
        return {name: rootEntityName(document.scene!, document.path), path: document.path, meshes, files: [...new Set(this.filesOf(document))].sort(compareText)};
    }

    private files(): AssetManifestFile[] {
        const recorded = [...this.meshFiles.values(), ...this.otherFiles.values()];
        const read = new Set(recorded.flatMap(files => [...files.read]));
        const paths = new Set(recorded.flatMap(files => [...files.read, ...files.statted]));
        const stats = new RecordingFileSource(this.root, this.base.files);
        return [...paths].sort(compareText).map((path): AssetManifestFile => {
            const {size, mtimeMs} = stats.stat(path);
            return read.has(path) ? {path, size, mtimeMs} : {path, size, mtimeMs, statOnly: true};
        });
    }
}

export function buildProjectAssetManifest(
    root: string,
    projectDirectory: string,
    base: AssetLoadOptions,
    registry: ComponentSchemaRegistry,
    onDemandPrefabBytes: number = ON_DEMAND_PREFAB_BYTES,
): ProjectAssetManifest {
    registerBuiltinImageDecoders();
    return new ProjectAssetRecorder(root, projectDirectory, base, registry, onDemandPrefabBytes).manifest();
}

async function engineSharingSchemasModule(projectFolder: string, schemasModule: string): Promise<string> {
    if (isInside(REPO_ROOT, projectFolder)) return schemasModule;
    const result = await Bun.build({entrypoints: [schemasModule], target: "bun", format: "esm", throw: false, plugins: [EXTERNAL_ENGINE_IMPORTS]});
    if (!result.success) throw new CliError(`bundling ${schemasModule} to find the project's asset references failed:`, result.logs.map(String));
    const bundled = join(projectBuildDirectory(projectFolder), ASSET_SCHEMAS_BUNDLE_FILE);
    mkdirSync(dirname(bundled), {recursive: true});
    writeFileSync(bundled, await result.outputs[0].text());
    return bundled;
}

export async function projectAssetRegistry(projectFolder: string): Promise<ComponentSchemaRegistry> {
    const schemasModule = join(projectFolder, GENERATED_SCHEMAS_FILE);
    const generated = existsSync(schemasModule)
        ? await import(await engineSharingSchemasModule(projectFolder, schemasModule)) as GeneratedSchemasModule
        : {};
    return createProjectSchemaRegistry({hostSchemas: EDITOR_SCHEMAS, schemas: generated.generatedSchemas ?? NO_SCHEMAS});
}
