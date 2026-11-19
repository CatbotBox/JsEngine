import * as fs from "fs";
import {dirname, join, relative, resolve} from "path";
import {Component, Resource, World} from "../src/engine/core";
import type {FileSource, FileStat, Platform} from "../src/engine/platform/platform";
import {fsFileSource} from "../src/engine/testing/fsFileSource";
import {nodePlatform} from "../src/hosts/terminal/nodePlatform";
import {
    componentSchema,
    DATA_ASSET_FORMAT,
    DATA_ASSET_VERSION,
    DataAssets,
    resourceSchema,
    SCENE_DOCUMENT_FORMAT,
    SCENE_DOCUMENT_VERSION,
    sceneEntitiesInCreationOrder,
    SceneManager,
} from "../src/engine/scene";
import type {ComponentSchemaRegistry} from "../src/engine/scene";
import type {ProjectAssetFiles, ProjectEntryModule, ProjectHost} from "../src/engine/project/projectEntry";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../src/engine/project/projectManifest";
import type {ProjectManifest, ProjectResourceBinding} from "../src/engine/project/projectManifest";
import {createProjectSchemaRegistry} from "../src/engine/project/projectSchemas";
import {startProject} from "../src/engine/project/projectStartup";

const ROOT = resolve(__dirname, "..");
const THIS_FILE = resolve(__filename);
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "dataAssets-fixture-";
const EDITOR_SOURCES = "src/editor/";
const RELATIVE_IMPORT = /(?:from|import|require)\s*\(?\s*["'](\.{1,2}(?:\/[^"']*)?)["']/g;
const RESOLVE_SUFFIXES: readonly string[] = ["", ".ts", ".js", "/index.ts"];
const START_SCENE = "scenes/main.scene.json";
const TUNING_PATH = "assets/tuning.asset.json";
const STALE_TUNING_PATH = "assets/stale.asset.json";
const GHOST_PATH = "assets/ghost.asset.json";
const MISSING_PATH = "assets/missing.asset.json";
const FILE_SPEED = 7;
const FILE_WAVES: readonly number[] = [3, 5, 8];
const DEFAULT_SPEED = 1;
const JSON_INDENT_SPACES = 2;

class Tuning extends Resource {
    public static readonly schema = resourceSchema(Tuning, "Tuning").number("speed").list("waves", {kind: "integer"}).string("title").build();
    public speed = DEFAULT_SPEED;
    public waves: number[] = [];
    public title = "untitled";
}

class Spawner extends Component {
    public static readonly schema = componentSchema(Spawner, "Spawner").dataAsset("tuning", Tuning).build();
    public tuning: Tuning | undefined = undefined;
}

interface SetupObservation {
    speedAtSetup?: number;
}

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

function json(value: unknown): string {
    return JSON.stringify(value, null, JSON_INDENT_SPACES) + "\n";
}

function assetText(type: string, fields: object): string {
    return json({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type, fields});
}

function writeFixtureFile(folder: string, path: string, text: string): void {
    const target = join(folder, ...path.split("/"));
    fs.mkdirSync(dirname(target), {recursive: true});
    fs.writeFileSync(target, text);
}

function rootedFileSource(folder: string): FileSource {
    const files = fsFileSource(fs);
    const inFolder = (path: string): string => join(folder, ...path.split("/"));
    return {
        readBytes: path => files.readBytes(inFolder(path)),
        readText: path => files.readText(inFolder(path)),
        exists: path => files.exists(inFolder(path)),
        stat: (path): FileStat => fs.statSync(inFolder(path)),
        write: (path, bytes) => files.write?.(inFolder(path), bytes),
    };
}

function terminalPlatform(folder: string): Platform {
    return {...nodePlatform(), files: rootedFileSource(folder)};
}

const FILES_ON_DISK: ProjectAssetFiles = {
    list: () => [],
    ensureLoaded: () => Promise.resolve(),
    loadFetchingAsNeeded<T>(load: () => T): Promise<T> {
        return Promise.resolve(load());
    },
};

function projectEntry(observation: SetupObservation): ProjectEntryModule {
    return {
        registerProjectSchemas(registry: ComponentSchemaRegistry): void {
            registry.registerResourceClass(Tuning);
            registry.registerComponentClass(Spawner);
        },
        setupProject(world: World): void {
            observation.speedAtSetup = world.resources.get(Tuning).speed;
        },
    };
}

function readManifest(folder: string): ProjectManifest {
    const validation = validateProjectManifest(fs.readFileSync(join(folder, PROJECT_MANIFEST_FILE), "utf8"), path => fs.existsSync(join(folder, path)));
    if (!validation.ok) throw new Error(`${PROJECT_MANIFEST_FILE}: ${validation.problems.join("; ")}`);
    return validation.manifest;
}

function writeFixture(folder: string, resources: readonly ProjectResourceBinding[]): void {
    writeFixtureFile(folder, PROJECT_MANIFEST_FILE, json({name: "Data asset fixture", entry: "project.ts", startScene: START_SCENE, resources}));
    writeFixtureFile(folder, "project.ts", "export function setupProject(): void {\r\n}\r\n");
    writeFixtureFile(folder, TUNING_PATH, assetText("Tuning", {speed: FILE_SPEED, waves: FILE_WAVES, title: "from disk"}));
    writeFixtureFile(folder, STALE_TUNING_PATH, assetText("Tuning", {speed: FILE_SPEED, retired: true}));
    writeFixtureFile(folder, GHOST_PATH, assetText("Ghost", {}));
    writeFixtureFile(folder, START_SCENE, json({
        format: SCENE_DOCUMENT_FORMAT,
        version: SCENE_DOCUMENT_VERSION,
        entities: [{id: 1, name: "spawner", enabled: true, components: {Spawner: {tuning: {path: TUNING_PATH}}}}],
    }));
}

interface Started {
    readonly world: World;
    readonly observation: SetupObservation;
    readonly start: Promise<unknown>;
}

function startFixture(folder: string): Started {
    const observation: SetupObservation = {};
    const entry = projectEntry(observation);
    const registry = createProjectSchemaRegistry(entry);
    const world = new World({platform: terminalPlatform(folder)});
    const host: ProjectHost = {files: FILES_ON_DISK, scenes: new SceneManager(world, registry)};
    return {world, observation, start: startProject(world, entry, host, readManifest(folder), registry)};
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    return "(no error)";
}

function fromRoot(file: string): string {
    return relative(ROOT, file).replace(/\\/g, "/");
}

function resolvedImport(importer: string, specifier: string): string | undefined {
    const base = resolve(dirname(importer), specifier);
    return RESOLVE_SUFFIXES.map(suffix => base + suffix).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function importClosure(entry: string): string[] {
    const reached = [entry];
    const seen = new Set(reached);
    for (let index = 0; index < reached.length; index++) {
        const text = fs.readFileSync(reached[index], "utf8");
        for (const match of text.matchAll(RELATIVE_IMPORT)) {
            const target = resolvedImport(reached[index], match[1]);
            if (target === undefined || seen.has(target)) continue;
            seen.add(target);
            reached.push(target);
        }
    }
    return reached.map(fromRoot);
}

async function verifyLoad(folder: string): Promise<void> {
    writeFixture(folder, [{type: "Tuning", path: TUNING_PATH}]);
    const {world, observation, start} = startFixture(folder);
    await start;
    const tuning = world.resources.get(Tuning);
    expect(tuning.speed === FILE_SPEED && JSON.stringify(tuning.waves) === JSON.stringify(FILE_WAVES) && tuning.title === "from disk",
        `the manifest's Tuning resource holds the file's values (${JSON.stringify(tuning)})`);
    expect(observation.speedAtSetup === FILE_SPEED, "setupProject already sees the loaded resource");
    const [spawnerEntity] = sceneEntitiesInCreationOrder(world);
    const spawner = spawnerEntity === undefined ? undefined : world.entityManager.getComponent<Spawner>(spawnerEntity, Spawner);
    expect(spawner?.tuning === tuning, "the start scene's data asset reference shares the resource instance");
    expect(world.resources.get(DataAssets).schemaChanges === "strict", "a host without the editor loads data assets strictly");
}

async function verifyCrashes(folder: string): Promise<void> {
    writeFixture(folder, [{type: "Tuning", path: MISSING_PATH}]);
    expect(await failureOf(startFixture(folder).start)
        === `${PROJECT_MANIFEST_FILE} resources[0]: could not load the Tuning data asset "${MISSING_PATH}": Data asset "${MISSING_PATH}" does not exist`,
        "a missing data asset file crashes the launch, naming the path and type");
    writeFixture(folder, [{type: "Ghost", path: GHOST_PATH}]);
    expect(await failureOf(startFixture(folder).start)
        === `${PROJECT_MANIFEST_FILE} resources[0]: the resource type "Ghost" for "${GHOST_PATH}" is not registered`,
        "an unregistered resource type crashes the launch, naming the type and path");
    writeFixture(folder, [{type: "Tuning", path: GHOST_PATH}]);
    expect(await failureOf(startFixture(folder).start)
        === `${PROJECT_MANIFEST_FILE} resources[0]: could not load the Tuning data asset "${GHOST_PATH}": Data asset "${GHOST_PATH}": expected a Tuning, but the file holds a Ghost`,
        "a file holding another type crashes the launch, naming both types");
    writeFixture(folder, [{type: "Tuning", path: STALE_TUNING_PATH}]);
    expect(await failureOf(startFixture(folder).start)
        === `${PROJECT_MANIFEST_FILE} resources[0]: could not load the Tuning data asset "${STALE_TUNING_PATH}": Data asset "${STALE_TUNING_PATH}": Tuning has no field "retired"`,
        "a field the schema lost crashes the launch outside the editor");
}

function verifyNoEditorRuntime(): void {
    const reached = importClosure(THIS_FILE);
    expect(reached.includes("src/engine/project/projectStartup.ts") && reached.includes("src/engine/scene/dataAssets.ts"), "the import graph reaches startProject and DataAssets");
    const editorModules = reached.filter(file => file.startsWith(EDITOR_SOURCES));
    expect(editorModules.length === 0, `no editor module is loaded (${editorModules.join(", ")})`);
}

async function main(): Promise<void> {
    fs.mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = fs.mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    try {
        verifyNoEditorRuntime();
        await verifyLoad(folder);
        await verifyCrashes(folder);
    } catch (error) {
        expect(false, `data assets: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    } finally {
        fs.rmSync(folder, {recursive: true, force: true});
    }
    if (failures > 0) {
        console.error(`${failures} data asset failures`);
        process.exit(1);
    }
    log("data assets OK");
    process.exit(0);
}

void main();
