import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {tmpdir} from "os";
import {dirname, join, relative, resolve, sep} from "path";
import * as ts from "typescript";
import {describe, expect, test} from "../engine/testing/harness";
import {PROJECT_MANIFEST_FILE} from "../engine/project/projectManifest";
import {SCENE_DOCUMENT_FORMAT, SCENE_DOCUMENT_VERSION} from "../engine/scene/sceneDocument";
import {scriptTemplate} from "../editor/page/projectTemplates";
import {createProjectFiles} from "../editor/project/projectTemplate";
import {engineImportError} from "./build/editorBuild";
import {linkEnginePackages} from "./enginePackageLinks";
import {ALL_CATALOG_SCHEMAS} from "./generate/engineCatalog";
import type {GeneratedSource} from "./generate/generatedHeader";
import {PROJECT_GENERATORS} from "./generate/generatedFiles";
import {isInside, projectCompilerOptions, ProjectSources} from "./generate/projectSources";
import {ENGINE_IMPORT_PREFIX} from "./projectLayout";
import {
    closestPublicEntryPoints,
    ENGINE_PACKAGES,
    ENTRY_POINT_BARREL_FILE,
    entryPointSegments,
    isPublicEntryPoint,
    PUBLIC_ENTRY_POINTS,
    readPackageManifest,
} from "./publicEntryPoints";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SOURCE_ROOT = join(REPO_ROOT, "src");
const OUTSIDE_REPO_FIXTURE_PREFIX = join(tmpdir(), "jsengine-entry-points-");
const INSIDE_REPO_FIXTURE_PREFIX = join(__dirname, "fixture-entry-points-");
const POSIX_SEPARATOR = "/";
const IMPORT_SPECIFIER = /from "([^"]+)"/g;
const LINE_BREAK = /\r?\n/;
const RELATIVE_SPECIFIER_PREFIX = ".";
const SCENE_FILE = "scenes/main.scene.json";
const GAME_FILE = "game.ts";
const GPU_BACKEND_FILE = "backend/gpu/glow.ts";
const IMAGE_FILES: readonly string[] = ["art/hero.png", "art/sky.jpg", "art/map.ppm"];
const IMPORTER_FILE = "importer.ts";

type FixtureFiles = Readonly<Record<string, string>>;

interface GeneratedFixture {
    readonly sources: readonly GeneratedSource[];
    readonly unresolved: readonly string[];
    readonly leavingProject: readonly string[];
}

function barrelOf(entryPoint: string): string {
    return join(SOURCE_ROOT, ...entryPointSegments(entryPoint), ENTRY_POINT_BARREL_FILE);
}

function slashed(path: string): string {
    return path.split(sep).join(POSIX_SEPARATOR);
}

function statementsOtherThanReExports(file: string): string[] {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    return source.statements
        .filter(statement => !ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined)
        .map(statement => `${slashed(relative(REPO_ROOT, file))}: ${statement.getText(source).split(LINE_BREAK)[0]}`);
}

function specifiersIn(text: string): string[] {
    return [...text.matchAll(IMPORT_SPECIFIER)].map(match => match[1]);
}

function engineSpecifiersIn(text: string): string[] {
    return specifiersIn(text).filter(specifier => specifier.startsWith(ENGINE_IMPORT_PREFIX));
}

function isOutsideEntryPoint(specifier: string): boolean {
    return !isPublicEntryPoint(specifier.slice(ENGINE_IMPORT_PREFIX.length));
}

function resolvedFrom(folder: string, specifier: string): string | undefined {
    return ts.resolveModuleName(specifier, join(folder, IMPORTER_FILE), projectCompilerOptions(), ts.sys).resolvedModule?.resolvedFileName;
}

function exportTargetOf(subpath: string): string {
    return `${subpath}${POSIX_SEPARATOR}${ENTRY_POINT_BARREL_FILE}`;
}

function sceneNamingEveryCatalogType(): string {
    const components = Object.fromEntries(ALL_CATALOG_SCHEMAS.map(schema => [schema.name, {}]));
    return JSON.stringify({format: SCENE_DOCUMENT_FORMAT, version: SCENE_DOCUMENT_VERSION, entities: [{id: 1, name: "everything", enabled: true, components}]});
}

function fixtureFiles(): FixtureFiles {
    return {
        [PROJECT_MANIFEST_FILE]: JSON.stringify({name: "Entry points", startScene: SCENE_FILE}),
        [SCENE_FILE]: sceneNamingEveryCatalogType(),
        [GAME_FILE]: `import {Component, System} from "${ENGINE_IMPORT_PREFIX}engine/core";\nexport class Spin extends Component {\n    speed = 1;\n}\nexport class SpinSystem extends System {\n}\n`,
        [GPU_BACKEND_FILE]: `import {System} from "${ENGINE_IMPORT_PREFIX}engine/core";\nexport class GlowSystem extends System {\n}\n`,
        ...Object.fromEntries(IMAGE_FILES.map(file => [file, ""])),
    };
}

function generateFixture(folderPrefix: string): GeneratedFixture {
    const folder = mkdtempSync(folderPrefix);
    try {
        if (!isInside(REPO_ROOT, folder)) linkEnginePackages(folder);
        for (const [path, text] of Object.entries(fixtureFiles())) {
            mkdirSync(dirname(join(folder, path)), {recursive: true});
            writeFileSync(join(folder, path), text);
        }
        const project = ProjectSources.read(folder, REPO_ROOT);
        const sources = PROJECT_GENERATORS.flatMap(generator => generator.generate(project).sources);
        const unresolved = sources.flatMap(source => engineSpecifiersIn(source.source)).filter(specifier => resolvedFrom(folder, specifier) === undefined);
        const leavingProject = sources.flatMap(source => specifiersIn(source.source)
            .filter(specifier => specifier.startsWith(RELATIVE_SPECIFIER_PREFIX))
            .filter(specifier => !isInside(folder, resolve(dirname(join(folder, source.file)), specifier))));
        return {sources, unresolved, leavingProject};
    } finally {
        rmSync(folder, {recursive: true, force: true});
    }
}

describe("public entry points", () => {
    test("each engine package is named after its folder under src and exports every subpath as that folder's index.ts barrel, which only re-exports", () => {
        expect(ENGINE_PACKAGES.length).toBeGreaterThan(0);
        expect(ENGINE_PACKAGES.filter(enginePackage => enginePackage.name !== ENGINE_IMPORT_PREFIX + slashed(relative(SOURCE_ROOT, enginePackage.folder))).map(enginePackage => enginePackage.name)).toEqual([]);
        const exportsMaps = ENGINE_PACKAGES.map(enginePackage => ({name: enginePackage.name, exports: readPackageManifest(enginePackage.folder).exports ?? {}}));
        expect(exportsMaps.flatMap(({name, exports}) => Object.entries(exports).filter(([subpath, target]) => target !== exportTargetOf(subpath)).map(([subpath]) => `${name} ${subpath}`))).toEqual([]);
        expect(PUBLIC_ENTRY_POINTS.length).toBeGreaterThan(0);
        expect(PUBLIC_ENTRY_POINTS.filter(entryPoint => !existsSync(barrelOf(entryPoint)))).toEqual([]);
        expect(PUBLIC_ENTRY_POINTS.flatMap(entryPoint => statementsOtherThanReExports(barrelOf(entryPoint)))).toEqual([]);
        expect(new Set(PUBLIC_ENTRY_POINTS).size).toBe(PUBLIC_ENTRY_POINTS.length);
    });

    test("the bun build check passes entry points and rejects any other engine path, naming the closest entry points", () => {
        expect(engineImportError(`${ENGINE_IMPORT_PREFIX}engine/core`)).toBeUndefined();
        expect(engineImportError(`${ENGINE_IMPORT_PREFIX}engine`)).toBeUndefined();
        const deep = engineImportError(`${ENGINE_IMPORT_PREFIX}engine/core/ownership`) ?? "";
        expect(deep.includes(`${ENGINE_IMPORT_PREFIX}engine/core/ownership is not an engine entry point`)).toBe(true);
        expect(deep.includes(`closest entry point instead: ${ENGINE_IMPORT_PREFIX}engine/core`)).toBe(true);
        expect((engineImportError(`${ENGINE_IMPORT_PREFIX}engine/core/index`) ?? "").includes("is not an engine entry point")).toBe(true);
        expect(closestPublicEntryPoints("engine/math/types/vec")).toEqual(["engine/math"]);
        expect(closestPublicEntryPoints("backends/pixels/2d/pixelsSpritePasses")).toEqual(["backends/pixels/2d"]);
        expect(closestPublicEntryPoints("editor/project/editorExtensions")).toEqual(["editor/desktop", "editor/extensions", "editor/launch"]);
        expect(closestPublicEntryPoints("hosts/web/worldWorker")[0]).toBe("hosts/web");
    });

    test("a project resolves entry points through its linked node_modules, and deeper engine paths do not resolve", () => {
        const folder = mkdtempSync(OUTSIDE_REPO_FIXTURE_PREFIX);
        try {
            expect(resolvedFrom(folder, `${ENGINE_IMPORT_PREFIX}engine/rendering/3d`)).toBeUndefined();
            linkEnginePackages(folder);
            expect(resolve(resolvedFrom(folder, `${ENGINE_IMPORT_PREFIX}engine/rendering/3d`) ?? "")).toBe(barrelOf("engine/rendering/3d"));
            expect(resolve(resolvedFrom(folder, `${ENGINE_IMPORT_PREFIX}engine`) ?? "")).toBe(barrelOf("engine"));
            expect(resolvedFrom(folder, `${ENGINE_IMPORT_PREFIX}engine/rendering/3d/mesh`)).toBeUndefined();
            expect(resolvedFrom(folder, `${ENGINE_IMPORT_PREFIX}engine/core/ownership`)).toBeUndefined();
            expect(resolvedFrom(folder, `${ENGINE_IMPORT_PREFIX}toolchain/cli`)).toBeUndefined();
        } finally {
            rmSync(folder, {recursive: true, force: true});
        }
    });

    test("a project outside the repo gets generated files whose engine imports are entry points that resolve through its packages", () => {
        const {sources, unresolved} = generateFixture(OUTSIDE_REPO_FIXTURE_PREFIX);
        const specifiers = sources.flatMap(source => engineSpecifiersIn(source.source));
        expect(specifiers.length).toBeGreaterThan(0);
        expect(specifiers.filter(isOutsideEntryPoint)).toEqual([]);
        expect(unresolved).toEqual([]);
    });

    test("a project inside the repo gets the same engine imports as one outside, never a relative path into src", () => {
        const inside = generateFixture(INSIDE_REPO_FIXTURE_PREFIX);
        const outside = generateFixture(OUTSIDE_REPO_FIXTURE_PREFIX);
        expect(inside.sources.map(source => engineSpecifiersIn(source.source))).toEqual(outside.sources.map(source => engineSpecifiersIn(source.source)));
        expect(inside.unresolved).toEqual([]);
        expect(inside.leavingProject).toEqual([]);
        expect(outside.leavingProject).toEqual([]);
    });

    test("the script and project templates import the engine only through entry points", () => {
        const scriptSpecifiers = engineSpecifiersIn(scriptTemplate("Mover").text);
        expect(scriptSpecifiers.length).toBeGreaterThan(0);
        const templateSpecifiers = [...scriptSpecifiers, ...createProjectFiles("Game").flatMap(file => engineSpecifiersIn(file.contents))];
        expect(templateSpecifiers.filter(isOutsideEntryPoint)).toEqual([]);
    });
});
