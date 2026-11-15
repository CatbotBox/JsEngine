import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import {projectFileExtension, projectRelativePath} from "./projectPaths";

export const PROJECT_MANIFEST_FILE = "jsengine.project.json";
export const PROJECT_ENTRY_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".js", ".mjs"];
export const SCENE_FILE_SUFFIX = ".scene.json";
export const ENGINE_IMPORT_PREFIX = "@jsengine/";
export const STARTER_ENTRY_FILE = "project.ts";
export const STARTER_SCENE_FILE = "scenes/main.scene.json";

const JSON_INDENT_SPACES = 2;

export interface ProjectManifest {
    readonly name: string;
    readonly entry: string;
    readonly startScene?: string;
}

export type ProjectManifestValidation =
    | {readonly ok: true; readonly manifest: ProjectManifest}
    | {readonly ok: false; readonly problems: readonly string[]};

export interface ProjectFile {
    readonly path: string;
    readonly contents: string;
}

type ManifestFields = {readonly [key: string]: unknown};

function isManifestObject(value: unknown): value is ManifestFields {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entryProblems(value: unknown, entryExists: ((path: string) => boolean) | undefined): {readonly entry?: string, readonly problems: string[]} {
    if (value === undefined) return {problems: [`"entry" is missing: name the game entry module, e.g. "${STARTER_ENTRY_FILE}"`]};
    if (typeof value !== "string" || value.trim().length === 0) return {problems: [`"entry" must be a non-empty string path, got ${JSON.stringify(value)}`]};
    const entry = projectRelativePath(value.trim());
    if (entry === undefined) return {problems: [`"entry" ${JSON.stringify(value)} must be a relative path that stays inside the project folder`]};
    const problems: string[] = [];
    if (!PROJECT_ENTRY_EXTENSIONS.includes(projectFileExtension(entry))) {
        problems.push(`"entry" ${JSON.stringify(value)} must name a ${PROJECT_ENTRY_EXTENSIONS.join(", ")} module`);
    } else if (entryExists !== undefined && !entryExists(entry)) {
        problems.push(`"entry" names ${entry}, which does not exist in the project folder`);
    }
    return {entry, problems};
}

function startSceneProblems(value: unknown): {readonly startScene?: string, readonly problems: string[]} {
    if (value === undefined) return {problems: []};
    if (typeof value !== "string" || value.trim().length === 0) return {problems: [`"startScene" must be a non-empty string path when present, got ${JSON.stringify(value)}`]};
    const startScene = projectRelativePath(value.trim());
    if (startScene === undefined) return {problems: [`"startScene" ${JSON.stringify(value)} must be a relative path that stays inside the project folder`]};
    if (!startScene.toLowerCase().endsWith(SCENE_FILE_SUFFIX)) return {problems: [`"startScene" ${JSON.stringify(value)} must name a ${SCENE_FILE_SUFFIX} file`]};
    return {startScene, problems: []};
}

export function validateProjectManifest(text: string | undefined, entryExists?: (path: string) => boolean): ProjectManifestValidation {
    if (text === undefined) return {ok: false, problems: [`${PROJECT_MANIFEST_FILE} is missing: this folder is not a JsEngine project`]};
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return {ok: false, problems: [`${PROJECT_MANIFEST_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]};
    }
    if (!isManifestObject(parsed)) return {ok: false, problems: [`${PROJECT_MANIFEST_FILE} must hold a JSON object, got ${JSON.stringify(parsed)}`]};
    const problems: string[] = [];
    const name = parsed.name;
    if (name === undefined) problems.push(`"name" is missing: give the project a name`);
    else if (typeof name !== "string" || name.trim().length === 0) problems.push(`"name" must be a non-empty string, got ${JSON.stringify(name)}`);
    const entry = entryProblems(parsed.entry, entryExists);
    const startScene = startSceneProblems(parsed.startScene);
    problems.push(...entry.problems, ...startScene.problems);
    if (problems.length > 0) return {ok: false, problems};
    const manifest: ProjectManifest = startScene.startScene === undefined
        ? {name: (name as string).trim(), entry: entry.entry!}
        : {name: (name as string).trim(), entry: entry.entry!, startScene: startScene.startScene};
    return {ok: true, manifest};
}

function starterEntrySource(): string {
    return [
        `import {EntityCommandBufferSystem} from "${ENGINE_IMPORT_PREFIX}engine/core";`,
        `import type {World} from "${ENGINE_IMPORT_PREFIX}engine/core";`,
        `import type {ComponentSchemaRegistry} from "${ENGINE_IMPORT_PREFIX}engine/scene";`,
        `import {Camera} from "${ENGINE_IMPORT_PREFIX}engine/rendering";`,
        `import {Sprite, SpriteImage} from "${ENGINE_IMPORT_PREFIX}engine/rendering/2d";`,
        `import {LocalPosition, LocalToWorld} from "${ENGINE_IMPORT_PREFIX}engine/translation";`,
        `import {SpritePixelPassSettings, SpritePixelPassSystem} from "${ENGINE_IMPORT_PREFIX}backends/pixels/2d";`,
        `import type {ProjectHost} from "${ENGINE_IMPORT_PREFIX}editor/project/projectEntry";`,
        ``,
        `const SPRITE_SIZE_PIXELS = 8;`,
        `const SPRITE_RGB = 0x40E0FF;`,
        ``,
        `export function registerProjectSchemas(registry: ComponentSchemaRegistry): void {`,
        `}`,
        ``,
        `export function setupProject(world: World, host: ProjectHost): void {`,
        `    const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();`,
        `    buffer.createEntity("spriteRenderSettings", [new SpritePixelPassSettings()]);`,
        `    world.ensureSystemExists(SpritePixelPassSystem);`,
        `    buffer.createEntity("camera", [new Camera(), new LocalPosition(), new LocalToWorld()]);`,
        `    const image = SpriteImage.solid(SPRITE_SIZE_PIXELS, SPRITE_SIZE_PIXELS, SPRITE_RGB);`,
        `    buffer.createEntity("sprite", [new Sprite(image), new LocalPosition(), new LocalToWorld()]);`,
        `}`,
        ``,
    ].join("\n");
}

function emptySceneSource(): string {
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: []}, null, JSON_INDENT_SPACES) + "\n";
}

export function createProjectFiles(name: string): readonly ProjectFile[] {
    if (name.trim().length === 0) throw new Error("A new project needs a non-empty name");
    const manifest: ProjectManifest = {name: name.trim(), entry: STARTER_ENTRY_FILE};
    return [
        {path: PROJECT_MANIFEST_FILE, contents: JSON.stringify(manifest, null, JSON_INDENT_SPACES) + "\n"},
        {path: STARTER_ENTRY_FILE, contents: starterEntrySource()},
        {path: STARTER_SCENE_FILE, contents: emptySceneSource()},
    ];
}
