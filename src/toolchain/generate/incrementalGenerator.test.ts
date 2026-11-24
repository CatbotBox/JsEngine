import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join, relative} from "path";
import {describe, expect, test} from "../../engine/testing/harness";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../../engine/scene/sceneDocument";
import {linkEnginePackages} from "../enginePackageLinks";
import {GENERATED_SCHEMAS_FILE, GENERATED_SYSTEMS_FILE} from "../projectLayout";
import {checkGeneratedFiles} from "./generatedFiles";
import type {GeneratedFiles} from "./generatedFiles";
import {IncrementalGenerator} from "./incrementalGenerator";
import {toPosix} from "./projectSources";

const FIXTURE_PREFIX = join(tmpdir(), "jsengine-incremental-");
const SPEED_FILE = "speed.ts";
const COMPONENTS_FILE = "components.ts";
const SPIN_SYSTEM_FILE = "spinSystem.ts";
const SHAPES_FILE = "shapes.ts";
const SHAPE_FOLDER_FILE = "shape/index.ts";
const SHAPE_DECLARATION_FILE = "shape.d.ts";
const GAME_FILE = "game.ts";
const ENGINE_MODULES_FILE = "engineModules.ts";
const WOBBLE_SYSTEM_FILE = "wobbleSystem.ts";
const SCENE_FILE = "scenes/main.scene.json";
const MANIFEST = {name: "Incremental"};
const RENDER_MESH_ENTRY = "RENDER_MESH_SCHEMA_ENTRY";
const SPRITE_ENTRY = "SPRITE_SCHEMA_ENTRY";
const CAMERA_ENTRY = "CAMERA_SCHEMA_ENTRY";
const SPEED_AS_NUMBER = `export type Speed = number;\n`;
const SPEED_AS_INT = `import type {Int} from "@jsengine/engine/scene";\nexport type Speed = Int;\n`;
const SHAPES_FROM_ENGINE = `import * as Rendering3d from "@jsengine/engine/rendering/3d";\nexport const shapes = Rendering3d;\n`;
const SHAPES_OF_OUR_OWN = `export const shapes = {RenderMesh: 0};\n`;
const SHAPE_DECLARATION = `import * as Rendering2d from "@jsengine/engine/rendering/2d";\nexport declare const shape: typeof Rendering2d;\n`;
const WOBBLE_SYSTEM = `import {System} from "@jsengine/engine/core";\nexport class WobbleSystem extends System {\n    public onUpdate(): void {\n    }\n}\n`;

const FIXTURE: Readonly<Record<string, string>> = {
    [PROJECT_MANIFEST_FILE]: JSON.stringify(MANIFEST),
    [SPEED_FILE]: SPEED_AS_NUMBER,
    [COMPONENTS_FILE]: `import {Component} from "@jsengine/engine/core";\nimport type {Speed} from "./speed";\nexport class Mover extends Component {\n    public speed: Speed = 0 as Speed;\n}\n`,
    [SPIN_SYSTEM_FILE]: `import {System} from "@jsengine/engine/core";\nimport {Mover} from "./components";\nexport class SpinSystem extends System {\n    public readonly target = Mover;\n    public onUpdate(): void {\n    }\n}\n`,
    [SHAPES_FILE]: SHAPES_FROM_ENGINE,
    [SHAPE_FOLDER_FILE]: `export const shape = {Sprite: 0};\n`,
    [GAME_FILE]: `import {shape} from "./shape";\nimport {shapes} from "./shapes";\nexport const HELD_MESH = shapes.RenderMesh;\nexport const HELD_SPRITE = shape.Sprite;\n`,
    [ENGINE_MODULES_FILE]: `import * as Rendering2d from "@jsengine/engine/rendering/2d";\nimport * as Scene from "@jsengine/engine/scene";\nexport const ENGINE_MODULES = [Rendering2d, Scene];\n`,
};

class Fixture {
    public readonly folder = mkdtempSync(FIXTURE_PREFIX);
    private readonly generator = new IncrementalGenerator();

    public constructor() {
        linkEnginePackages(this.folder);
        for (const [path, text] of Object.entries(FIXTURE)) this.write(path, text);
    }

    public write(path: string, text: string): void {
        const target = join(this.folder, path);
        mkdirSync(dirname(target), {recursive: true});
        writeFileSync(target, text);
    }

    public remove(path: string): void {
        rmSync(join(this.folder, path));
    }

    public regenerate(): GeneratedFiles {
        const [generated] = this.generator.writeGeneratedFiles([this.folder]);
        const full = checkGeneratedFiles(this.folder);
        expect(full.files.filter(file => file.state !== "upToDate").map(file => file.path)).toEqual([]);
        expect(generated.files.map(file => [file.path, file.source])).toEqual(full.files.map(file => [file.path, file.source]));
        expect(generated.warnings).toEqual(full.warnings);
        return generated;
    }

    public extractedFiles(): string[] {
        return this.generator.lastRound.extractedFiles.map(file => toPosix(relative(this.folder, file))).sort();
    }

    public get parsedFiles(): number {
        return this.generator.lastRound.parsedFiles;
    }

    public get reusedPrograms(): number {
        return this.generator.lastRound.reusedPrograms;
    }

    public dispose(): void {
        rmSync(this.folder, {recursive: true, force: true});
    }
}

function withFixture(body: (fixture: Fixture) => void): void {
    const fixture = new Fixture();
    try {
        body(fixture);
    } finally {
        fixture.dispose();
    }
}

function sourceOf(generated: GeneratedFiles, file: string): string {
    const found = generated.files.find(each => toPosix(each.path).endsWith(`/${file}`));
    if (found === undefined) throw new Error(`no ${file} was generated`);
    return found.source;
}

function sceneNaming(...componentNames: readonly string[]): string {
    const components = Object.fromEntries(componentNames.map(name => [name, {}]));
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [{id: 1, name: "thing", enabled: true, components}]});
}

describe("incremental generation", () => {
    test("an edit regenerates what a full run generates, re-extracting only the edited file and the files that import it", () => {
        withFixture(fixture => {
            const first = fixture.regenerate();
            expect(fixture.reusedPrograms).toBe(0);
            expect(fixture.extractedFiles()).toEqual([COMPONENTS_FILE, ENGINE_MODULES_FILE, GAME_FILE, SHAPE_FOLDER_FILE, SHAPES_FILE, SPEED_FILE, SPIN_SYSTEM_FILE].sort());
            expect(sourceOf(first, GENERATED_SCHEMAS_FILE).includes(RENDER_MESH_ENTRY)).toBe(true);

            const unchanged = fixture.regenerate();
            expect([fixture.parsedFiles, fixture.reusedPrograms, fixture.extractedFiles().length]).toEqual([0, 1, 0]);
            expect(unchanged.files.map(file => file.source)).toEqual(first.files.map(file => file.source));

            fixture.write(SPEED_FILE, SPEED_AS_INT);
            const retyped = fixture.regenerate();
            expect([fixture.parsedFiles, fixture.reusedPrograms]).toEqual([1, 1]);
            expect(fixture.extractedFiles()).toEqual([COMPONENTS_FILE, SPEED_FILE, SPIN_SYSTEM_FILE].sort());
            expect(sourceOf(retyped, GENERATED_SCHEMAS_FILE).includes(`{key: "speed", kind: "integer", typeName: "Speed"}`)).toBe(true);

            fixture.write(SHAPES_FILE, SHAPES_OF_OUR_OWN);
            const reshaped = fixture.regenerate();
            expect(fixture.extractedFiles()).toEqual([GAME_FILE, SHAPES_FILE]);
            expect(sourceOf(reshaped, GENERATED_SCHEMAS_FILE).includes(RENDER_MESH_ENTRY)).toBe(false);
        });
    });

    test("a new file that changes where an unchanged file's import resolves re-resolves the program", () => {
        withFixture(fixture => {
            expect(sourceOf(fixture.regenerate(), GENERATED_SCHEMAS_FILE).includes(SPRITE_ENTRY)).toBe(false);
            fixture.write(SHAPE_DECLARATION_FILE, SHAPE_DECLARATION);
            const shadowed = fixture.regenerate();
            expect([fixture.parsedFiles, fixture.reusedPrograms]).toEqual([1, 0]);
            expect(fixture.extractedFiles()).toEqual([GAME_FILE]);
            expect(sourceOf(shadowed, GENERATED_SCHEMAS_FILE).includes(SPRITE_ENTRY)).toBe(true);
            fixture.remove(SHAPE_DECLARATION_FILE);
            expect(sourceOf(fixture.regenerate(), GENERATED_SCHEMAS_FILE).includes(SPRITE_ENTRY)).toBe(false);
        });
    });

    test("added and removed files, data files and the manifest regenerate as a full run does", () => {
        withFixture(fixture => {
            fixture.regenerate();
            fixture.write(WOBBLE_SYSTEM_FILE, WOBBLE_SYSTEM);
            fixture.write(SCENE_FILE, sceneNaming("Camera"));
            const added = fixture.regenerate();
            expect(fixture.extractedFiles()).toEqual([WOBBLE_SYSTEM_FILE]);
            expect(sourceOf(added, GENERATED_SYSTEMS_FILE).includes("WobbleSystem")).toBe(true);
            expect(sourceOf(added, GENERATED_SCHEMAS_FILE).includes(CAMERA_ENTRY)).toBe(true);

            fixture.write(PROJECT_MANIFEST_FILE, JSON.stringify({...MANIFEST, systems: {exclude: ["SpinSystem", "Missing"]}}));
            const excluded = fixture.regenerate();
            expect([fixture.parsedFiles, fixture.extractedFiles().length]).toEqual([0, 0]);
            expect(sourceOf(excluded, GENERATED_SYSTEMS_FILE).includes("SpinSystem")).toBe(false);
            expect(excluded.warnings.length).toBe(1);

            fixture.remove(WOBBLE_SYSTEM_FILE);
            fixture.remove(SCENE_FILE);
            const removed = fixture.regenerate();
            expect(sourceOf(removed, GENERATED_SYSTEMS_FILE).includes("WobbleSystem")).toBe(false);
            expect(sourceOf(removed, GENERATED_SCHEMAS_FILE).includes(CAMERA_ENTRY)).toBe(false);
        });
    });
});
