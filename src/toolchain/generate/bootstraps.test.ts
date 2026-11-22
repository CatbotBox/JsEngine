import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {basename, dirname, join, resolve} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {editorWorkerMainFile, GENERATED_GAME_FILE, TERMINAL_MAIN_FILE, WEB_PAGE_BOOTSTRAP_FILE, webPageMainFile, webWorkerMainFile} from "../projectLayout";
import {GAME_GENERATED_HEADER, GAME_GENERATOR} from "./gameModule";
import type {GeneratedSource, GeneratorOutput, ProjectGenerator} from "./generatedHeader";
import {MAINS_GENERATED_HEADER, MAINS_GENERATOR} from "./mains";
import {ProjectSources} from "./projectSources";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const LINE_BREAK = "\r\n";
const INSIDE_REPO_FIXTURE_PREFIX = join(__dirname, "fixture-");
const OUTSIDE_REPO_FIXTURE_PREFIX = join(tmpdir(), "jsengine-bootstraps-");
const OWN_ENTRY = "src/main.ts";
const PNG_FILE = "art/hero.png";
const JPEG_FILE = "art/sky.JPG";

type FixtureFiles = Readonly<Record<string, string>>;

interface Generated {
    readonly folder: string;
    readonly output: GeneratorOutput;
}

function generateFixture(generator: ProjectGenerator, manifest: object, folderPrefix = OUTSIDE_REPO_FIXTURE_PREFIX, files: FixtureFiles = {}): Generated {
    const folder = mkdtempSync(folderPrefix);
    try {
        for (const [path, text] of Object.entries({...files, [PROJECT_MANIFEST_FILE]: JSON.stringify(manifest)})) {
            const target = join(folder, path);
            mkdirSync(dirname(target), {recursive: true});
            writeFileSync(target, text);
        }
        return {folder, output: generator.generate(ProjectSources.read(folder, REPO_ROOT))};
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

function sourceOf(output: GeneratorOutput, file: string): string {
    const generated = output.sources.find((source: GeneratedSource) => source.file === file);
    if (generated === undefined) throw new Error(`the generator wrote no ${file}`);
    return generated.source;
}

function expectLine(lines: readonly string[], line: string): void {
    expect(lines.filter(each => each === line)).toEqual([line]);
}

function linesOf(output: GeneratorOutput, file: string): string[] {
    return sourceOf(output, file).split(LINE_BREAK);
}

describe("game bootstrap generator", () => {
    test("writes the manifest's start scene and resources as literals and starts them through startGame", () => {
        const {output} = generateFixture(GAME_GENERATOR, {
            name: "Game",
            startScene: "scenes/main.scene.json",
            resources: [{type: "Tuning", path: "assets/tuning.asset.json"}],
        }, INSIDE_REPO_FIXTURE_PREFIX);
        const lines = linesOf(output, GENERATED_GAME_FILE);
        expect(lines[0]).toBe(GAME_GENERATED_HEADER);
        expectLine(lines, `import {startGame} from "../../../../engine/project/startGame";`);
        expectLine(lines, `import {generatedSchemas} from "./schemas";`);
        expectLine(lines, `    {type: "Tuning", path: "assets/tuning.asset.json"},`);
        expectLine(lines, `export const projectStartScene: string | undefined = "scenes/main.scene.json";`);
        expectLine(lines, `        systems: [...backendSystems, ...generatedSystems],`);
    });

    test("a manifest without a start scene or resources starts nothing", () => {
        const lines = linesOf(generateFixture(GAME_GENERATOR, {name: "Empty"}).output, GENERATED_GAME_FILE);
        expectLine(lines, `export const projectResources: readonly ProjectResourceBinding[] = [];`);
        expectLine(lines, `export const projectStartScene: string | undefined = undefined;`);
    });

    test("a project outside the repo imports the engine through the alias, and the game registers no backend's schemas", () => {
        const source = sourceOf(generateFixture(GAME_GENERATOR, {name: "Outside"}).output, GENERATED_GAME_FILE);
        expect(source.includes(`from "@jsengine/engine/project/startGame";`)).toBe(true);
        expect(source.includes("backends/")).toBe(false);
    });

    test("registers the image decoders for the image files in the project folder, and none without images", () => {
        const withImages = linesOf(generateFixture(GAME_GENERATOR, {name: "Pictures"}, OUTSIDE_REPO_FIXTURE_PREFIX, {[PNG_FILE]: "", [JPEG_FILE]: ""}).output, GENERATED_GAME_FILE);
        expectLine(withImages, `import {PNG_IMAGE_DECODER} from "@jsengine/engine/assets/image/png";`);
        expectLine(withImages, `import {JPEG_IMAGE_DECODER} from "@jsengine/engine/assets/image/jpeg";`);
        expectLine(withImages, `export const projectImageDecoders: readonly ImageDecoderEntry[] = [PNG_IMAGE_DECODER, JPEG_IMAGE_DECODER];`);
        expectLine(withImages, `        imageDecoders: projectImageDecoders,`);
        const withoutImages = linesOf(generateFixture(GAME_GENERATOR, {name: "Words"}).output, GENERATED_GAME_FILE);
        expectLine(withoutImages, `export const projectImageDecoders: readonly ImageDecoderEntry[] = [];`);
        expect(withoutImages.some(line => line.includes("assets/image/png") || line.includes("assets/image/jpeg"))).toBe(false);
    });

    test("is deterministic", () => {
        const manifest = {name: "Game", startScene: "scenes/main.scene.json"};
        expect(sourceOf(generateFixture(GAME_GENERATOR, manifest).output, GENERATED_GAME_FILE))
            .toBe(sourceOf(generateFixture(GAME_GENERATOR, manifest).output, GENERATED_GAME_FILE));
    });
});

describe("mains generator", () => {
    test("writes one main per target and backend, each with the mains header", () => {
        const {output} = generateFixture(MAINS_GENERATOR, {name: "Game"});
        expect(output.sources.map(source => source.file)).toEqual(MAINS_GENERATOR.files);
        expect(output.sources.every(source => source.source.startsWith(MAINS_GENERATED_HEADER + LINE_BREAK))).toBe(true);
    });

    test("the terminal main installs the cells backend and starts the generated game from the project folder", () => {
        const lines = linesOf(generateFixture(MAINS_GENERATOR, {name: "Terminal Game"}).output, TERMINAL_MAIN_FILE);
        expectLine(lines, `import {startProject} from "./game";`);
        expectLine(lines, "const PROJECT_DIRECTORY = `${__dirname}/..`;");
        expectLine(lines, `runTerminalGame("Terminal Game", async (world, presenter) => {`);
        expectLine(lines, `import {generatedCellsPasses, generatedCellsSystems} from "./systems.cells";`);
        expectLine(lines, `import {generatedCellsSchemas} from "./schemas.cells";`);
        expectLine(lines, `    installCellsBackend(world, presenter, generatedCellsPasses);`);
        expectLine(lines, `    await startProject(world, {directory: PROJECT_DIRECTORY, backendSystems: generatedCellsSystems, hostSchemas: generatedCellsSchemas});`);
    });

    test("web mains name the bundles after the project folder and the worker reads the project's site folder", () => {
        const {folder, output} = generateFixture(MAINS_GENERATOR, {name: "Web Game"});
        const slug = basename(folder).toLowerCase();
        expectLine(linesOf(output, WEB_PAGE_BOOTSTRAP_FILE), `loadRenderBackendScript({cells: "${slug}-cells.js", pixels: "${slug}-pixels.js", gpu: "${slug}-gpu.js"}, {defaultBackend: pageDefaultRenderBackend(document)});`);
        expectLine(linesOf(output, webPageMainFile("pixels")), `startWorldPage("${slug}-pixels.worker.js", "Web Game", pixelCanvasDisplayFromQuery);`);
        const worker = linesOf(output, webWorkerMainFile("pixels"));
        expectLine(worker, `const PROJECT_DIRECTORY = "${slug}";`);
        expectLine(worker, `    installPixelsBackend(world, presenter, generatedPixelsPasses);`);
        expectLine(worker, `    await runProjectInWorker(world, page, files, {directory: PROJECT_DIRECTORY, startProject, backendSystems: generatedPixelsSystems, hostSchemas: generatedPixelsSchemas});`);
    });

    test("the gpu worker asks for the device before it creates the world", () => {
        const lines = linesOf(generateFixture(MAINS_GENERATOR, {name: "Gpu Game"}).output, webWorkerMainFile("gpu"));
        const device = lines.indexOf(`    const device = await requestGpuDevice(page);`);
        const world = lines.indexOf(`    const world = new App({platform: page.platform}).createDebugWorld();`);
        expect(device >= 0 && world > device).toBe(true);
        expectLine(lines, `    installGpuBackend(world, device, presenter, generatedGpuPasses);`);
    });

    test("each backend gets an editor main that hands the editor the entry's startProject, its system lists and its installer with every standard pass", () => {
        const {output} = generateFixture(MAINS_GENERATOR, {name: "Edited"});
        const cells = linesOf(output, editorWorkerMainFile("cells"));
        expectLine(cells, `runProjectEditorWorker(startProject, {shared: generatedSystems, backend: generatedCellsSystems}, async (world, page) => {`);
        expectLine(cells, `    const presenter = page.cellPresenter();`);
        expectLine(cells, `    installCellsBackend(world, presenter, CELLS_STANDARD_PASSES);`);
        expect(cells.some(line => line.includes("Pixels") || line.includes("Gpu"))).toBe(false);
        const gpu = linesOf(output, editorWorkerMainFile("gpu"));
        expectLine(gpu, `    const device = await requestGpuDevice(page);`);
        expectLine(gpu, `    installGpuBackend(world, device, presenter, GPU_STANDARD_PASSES);`);
        expectLine(linesOf(output, editorWorkerMainFile("pixels")), `    installPixelsBackend(world, presenter, PIXELS_STANDARD_PASSES);`);
    });

    test("every main starts the manifest's own entry when it names one", () => {
        const {output} = generateFixture(MAINS_GENERATOR, {name: "Own", entry: OWN_ENTRY}, OUTSIDE_REPO_FIXTURE_PREFIX, {[OWN_ENTRY]: ""});
        const starting = output.sources.filter(source => source.source.includes("startProject"));
        expect(starting.length).toBeGreaterThan(0);
        expect(starting.every(source => source.source.includes(`import {startProject} from "../src/main";`))).toBe(true);
    });
});
