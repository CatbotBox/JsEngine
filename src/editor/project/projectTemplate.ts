import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import {ENGINE_IMPORT_PREFIX, PROJECT_MANIFEST_FILE, STARTER_ENTRY_FILE} from "../../engine/project/projectManifest";
import type {ProjectManifest} from "../../engine/project/projectManifest";

export const STARTER_SCENE_FILE = "scenes/main.scene.json";

const JSON_INDENT_SPACES = 2;

export interface ProjectFile {
    readonly path: string;
    readonly contents: string;
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
        `import type {ProjectHost} from "${ENGINE_IMPORT_PREFIX}engine/project/projectEntry";`,
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
