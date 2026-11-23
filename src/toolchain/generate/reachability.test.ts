import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join, resolve} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import {DATA_ASSET_FORMAT, DATA_ASSET_VERSION} from "../../engine/scene/dataAssetDocument";
import {GENERATED_SCHEMAS_FILE, generatedBackendSchemasFile, generatedBackendSystemsFile} from "../projectLayout";
import type {GeneratorOutput} from "./generatedHeader";
import {ProjectSources} from "./projectSources";
import {linkEnginePackages} from "../enginePackageLinks";
import {UNKNOWN_DATA_TYPE_WARNING, UNMATCHED_KEEP_WARNING} from "./reachability";
import {SCHEMAS_GENERATOR} from "./schemas";
import {SYSTEMS_GENERATOR} from "./systems";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const FIXTURE_PREFIX = join(tmpdir(), "jsengine-reachability-");
const SCENE_FILE = "scenes/main.scene.json";
const PREFAB_FILE = "prefabs/hud.prefab.json";
const DATA_ASSET_FILE = "assets/random.asset.json";
const CODE_FILE = "game.ts";

type FixtureFiles = Readonly<Record<string, string>>;

interface Generated {
    readonly schemas: GeneratorOutput;
    readonly systems: GeneratorOutput;
}

function sceneNaming(...componentNames: readonly string[]): string {
    const components = Object.fromEntries(componentNames.map(name => [name, {}]));
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [{id: 1, name: "thing", enabled: true, components}]});
}

function dataAssetOf(type: string): string {
    return JSON.stringify({format: DATA_ASSET_FORMAT, version: DATA_ASSET_VERSION, type, fields: {}});
}

function generate(files: FixtureFiles, manifest: object = {name: "Reach"}): Generated {
    const folder = mkdtempSync(FIXTURE_PREFIX);
    try {
        linkEnginePackages(folder);
        for (const [path, text] of Object.entries({...files, [PROJECT_MANIFEST_FILE]: JSON.stringify(manifest)})) {
            mkdirSync(dirname(join(folder, path)), {recursive: true});
            writeFileSync(join(folder, path), text);
        }
        const sources = ProjectSources.read(folder, REPO_ROOT);
        return {schemas: SCHEMAS_GENERATOR.generate(sources), systems: SYSTEMS_GENERATOR.generate(sources)};
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

function sourceOf(output: GeneratorOutput, file: string): string {
    const generated = output.sources.find(source => source.file === file);
    if (generated === undefined) throw new Error(`no ${file} was generated`);
    return generated.source;
}

function listed(source: string, name: string): boolean {
    return source.split("\r\n").includes(`    ${name},`);
}

describe("reachable engine and backend schemas", () => {
    test("the schema list holds the engine types the project's files name, with the asset types their fields load", () => {
        const engine = sourceOf(generate({[SCENE_FILE]: sceneNaming("Camera", "Sprite")}).schemas, GENERATED_SCHEMAS_FILE);
        expect(["CAMERA_SCHEMA_ENTRY", "SPRITE_SCHEMA_ENTRY", "SPRITE_IMAGE_ASSET_TYPE_ENTRY"].every(name => listed(engine, name))).toBe(true);
        expect(["RENDER_MESH_SCHEMA_ENTRY", "MESH_ASSET_TYPE_ENTRY", "POINT_LIGHT_SCHEMA_ENTRY"].some(name => engine.includes(name))).toBe(false);
    });

    test("each host lists its own backend's named settings and carries the other backends' type names", () => {
        const {schemas} = generate({[SCENE_FILE]: sceneNaming("SpriteCellPassSettings", "SpritePixelPassSettings")});
        const cells = sourceOf(schemas, generatedBackendSchemasFile("cells"));
        expect(listed(cells, "SPRITE_CELL_PASS_SETTINGS_SCHEMA_ENTRY")).toBe(true);
        expect(cells.includes(`"SpritePixelPassSettings"`) && !cells.includes(`"SpriteCellPassSettings"`)).toBe(true);
        const gpu = sourceOf(schemas, generatedBackendSchemasFile("gpu"));
        expect(listed(gpu, "SPRITE_PIXEL_PASS_SETTINGS_SCHEMA_ENTRY")).toBe(true);
        expect(gpu.includes(`"MeshPixelPassSettings"`) && gpu.includes(`"SpriteCellPassSettings"`)).toBe(true);
    });

    test("an engine class the project's code uses is reachable, and so are the asset types its fields load", () => {
        const code = `import {RenderMesh} from "@jsengine/engine/rendering/3d";\nexport const MESH_HOLDER = RenderMesh;\n`;
        const engine = sourceOf(generate({[CODE_FILE]: code}).schemas, GENERATED_SCHEMAS_FILE);
        expect(listed(engine, "RENDER_MESH_SCHEMA_ENTRY") && listed(engine, "MESH_ASSET_TYPE_ENTRY")).toBe(true);
    });

    test("Random is reachable only when the project's data names it, not when code uses it", () => {
        const code = `import {Random} from "@jsengine/engine/math";\nexport const DICE = new Random();\n`;
        expect(sourceOf(generate({[CODE_FILE]: code}).schemas, GENERATED_SCHEMAS_FILE).includes("RANDOM_SCHEMA_ENTRY")).toBe(false);
        expect(listed(sourceOf(generate({[DATA_ASSET_FILE]: dataAssetOf("Random")}).schemas, GENERATED_SCHEMAS_FILE), "RANDOM_SCHEMA_ENTRY")).toBe(true);
        const bound = generate({}, {name: "Reach", resources: [{type: "Random", path: DATA_ASSET_FILE}]});
        expect(listed(sourceOf(bound.schemas, GENERATED_SCHEMAS_FILE), "RANDOM_SCHEMA_ENTRY")).toBe(true);
    });

    test("the keep list makes a type reachable, and a kept name nothing provides is a warning", () => {
        const kept = generate({}, {name: "Reach", keep: ["PointLight", "Nothing"]});
        expect(listed(sourceOf(kept.schemas, GENERATED_SCHEMAS_FILE), "POINT_LIGHT_SCHEMA_ENTRY")).toBe(true);
        expect(kept.schemas.warnings).toEqual([`keep: "Nothing" ${UNMATCHED_KEEP_WARNING}; remove it from ${PROJECT_MANIFEST_FILE}`]);
    });

    test("a type the project's data names that no schema provides is a warning naming the file", () => {
        expect(generate({[SCENE_FILE]: sceneNaming("Ghost")}).schemas.warnings).toEqual([`${SCENE_FILE} names "Ghost", ${UNKNOWN_DATA_TYPE_WARNING}`]);
    });
});

describe("reachable render passes", () => {
    test("a backend creates only the passes whose types the project names, in the standard order", () => {
        const twoD = sourceOf(generate({[SCENE_FILE]: sceneNaming("Sprite", "TextSprite")}).systems, generatedBackendSystemsFile("pixels"));
        expect(listed(twoD, "...PIXELS_SPRITE_PASSES") && listed(twoD, "...PIXELS_WORLD_TEXT_PASSES")).toBe(true);
        expect(twoD.includes("PIXELS_HUD_SPRITE_PASSES") || twoD.includes("PIXELS_HUD_TEXT_PASSES") || twoD.includes("PIXELS_MESH_PASSES")).toBe(false);
        const withHud = sourceOf(generate({[SCENE_FILE]: sceneNaming("Sprite", "TextSprite", "RenderMesh"), [PREFAB_FILE]: sceneNaming("HudElement")}).systems, generatedBackendSystemsFile("cells"));
        const order = ["CELLS_MESH_PASSES", "CELLS_SPRITE_PASSES", "CELLS_WORLD_TEXT_PASSES", "CELLS_HUD_SPRITE_PASSES", "CELLS_HUD_TEXT_PASSES"].map(name => withHud.indexOf(`    ...${name},`));
        expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]))).toBe(true);
    });

    test("the gpu host pairs the gpu mesh pass with the pixels 2D and HUD passes", () => {
        const gpu = sourceOf(generate({[SCENE_FILE]: sceneNaming("RenderMesh", "Sprite")}).systems, generatedBackendSystemsFile("gpu"));
        expect(listed(gpu, "...GPU_MESH_PASSES") && listed(gpu, "...PIXELS_SPRITE_PASSES")).toBe(true);
        expect(gpu.includes("PIXELS_MESH_PASSES")).toBe(false);
    });
});
