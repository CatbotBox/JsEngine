import {describe, expect, test} from "./harness";
import type * as Fs from "fs";
import type * as Path from "path";
import type * as TypeScript from "typescript";

const fs = require("fs") as typeof Fs;
const path = require("path") as typeof Path;
const ts = require("typescript") as typeof TypeScript;

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const DEMO = path.join(ROOT, "demo");
const TYPESCRIPT_EXTENSION = ".ts";
const TEST_SUFFIX = ".test.ts";
const BUILD_OUTPUT_DIRECTORIES = new Set(["dist", "dist-prod", "node_modules"]);

const NODE_API_USE = /require\("(fs|path|os|zlib|worker_threads|util|readline)"\)|from "(node:)?(fs|path|os|zlib|worker_threads|util|perf_hooks|timers|readline)"|process\.(stdout|stdin|env)/;
const NODE_API_HOSTS = ["src/hosts/terminal/", "src/hosts/desktop/", "src/toolchain/"];

const BUN_TEST_IMPORT = /from\s+["']bun:test["']|require\(\s*["']bun:test["']\s*\)/;
const HARNESS = path.join(SRC, "engine", "testing", "harness.ts");
const SUITE_ROOTS = [SRC, DEMO];

const SOURCE_IMPORT = /(?:from|import|require)\s*\(?\s*["'](\.{1,2}(?:\/[^"']*)?|@jsengine\/[^"']*)["']/g;
const RESOLVE_SUFFIXES = ["", ".ts", ".js", "/index.ts"];

const BACKENDS = ["backends/cells", "backends/pixels", "backends/gpu"];
const TERMINAL_INPUT = "hosts/terminalInput";
const DEMO_BACKENDS = ["demo backend cells", "demo backend pixels", "demo backend gpu"];

const ALLOWED_LAYERS: Readonly<Record<string, readonly string[]>> = {
    "engine": ["engine"],
    "backends/cells": ["engine", "backends/cells"],
    "backends/pixels": ["engine", "backends/pixels"],
    "backends/gpu": ["engine", "backends/pixels", "backends/gpu"],
    [TERMINAL_INPUT]: ["engine", TERMINAL_INPUT],
    "hosts/terminal": ["engine", ...BACKENDS, TERMINAL_INPUT, "hosts/terminal"],
    "hosts/web": ["engine", ...BACKENDS, "hosts/web"],
    "hosts/desktop": ["engine", ...BACKENDS, "editor project", "hosts/desktop"],
    "editor project": ["engine", "editor project"],
    "editor": ["engine", ...BACKENDS, "editor project", "editor"],
    "editor launch": ["engine", ...BACKENDS, TERMINAL_INPUT, "hosts/web", "editor project", "editor", "editor launch"],
    "demo": ["engine", "demo"],
    "demo backend cells": ["engine", "backends/cells", "demo", "demo backend cells"],
    "demo backend pixels": ["engine", "backends/pixels", "demo", "demo backend pixels"],
    "demo backend gpu": ["engine", "backends/pixels", "backends/gpu", "demo", "demo backend gpu"],
    "demo launch": ["engine", ...BACKENDS, TERMINAL_INPUT, "hosts/terminal", "hosts/web", "demo", ...DEMO_BACKENDS, "demo launch"],
    "demo generated": ["engine", ...BACKENDS, TERMINAL_INPUT, "hosts/terminal", "hosts/web", "editor launch", "demo", ...DEMO_BACKENDS, "demo generated"],
    "toolchain": ["engine", ...BACKENDS, TERMINAL_INPUT, "hosts/terminal", "hosts/web", "hosts/desktop", "editor project", "editor", "toolchain"],
};

const UNSCHEDULED = "unscheduled";

const WRONG_DIRECTION_ALLOWLIST_REMOVED_IN_STEP: Readonly<Record<string, number | typeof UNSCHEDULED>> = {};
const WRONG_DIRECTION_ALLOWLIST = Object.keys(WRONG_DIRECTION_ALLOWLIST_REMOVED_IN_STEP);
const DEMO_LAUNCH_ENTRY = "index.ts";
const DEMO_BACKEND_FOLDER = "backend";
const DEMO_GENERATED_FOLDER = "generated";
const GENERATED_BACKEND_FILE = /\.(cells|pixels|gpu)\.ts$/;
const EDITOR_LAUNCH_FOLDER = "launch";
const EDITOR_PROJECT_FOLDER = "project";
const EDITOR_SOURCES = "src/editor/";
const GENERATED_MAIN_PREFIX = "main.";
const GENERATED_EDITOR_MAIN_PREFIX = "main.editor-";
const SIDE_EFFECT_FREE_ROOTS = [path.join(SRC, "engine"), path.join(SRC, "backends")];
const TOP_LEVEL_STATEMENT_ALLOWLIST: readonly string[] = [];
const LINE_BREAK = /\r?\n/;
const DECLARATION_STATEMENT_KINDS: ReadonlySet<TypeScript.SyntaxKind> = new Set([
    ts.SyntaxKind.ImportDeclaration,
    ts.SyntaxKind.ImportEqualsDeclaration,
    ts.SyntaxKind.ExportDeclaration,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.VariableStatement,
]);
const ENGINE_WORLD_SOURCE = "src/engine/core/world.ts";
const ENGINE_START_GAME_SOURCE = "src/engine/project/startGame.ts";
const SOURCE_PREFIX = "src/";
const PACKAGE_MANIFEST_FILE = "package.json";
const PACKAGE_SCOPE = "@jsengine/";
const PACKAGE_ROOT_EXPORT = ".";
const BARREL_FILE = "index.ts";

interface PackageManifest {
    readonly name: string;
    readonly workspaces?: readonly string[];
    readonly exports?: Readonly<Record<string, string>>;
}

interface DemoImport {
    readonly importer: string;
    readonly specifier: string;
    readonly target: string | undefined;
}

function readPackageManifest(folder: string): PackageManifest {
    return JSON.parse(fs.readFileSync(path.join(folder, PACKAGE_MANIFEST_FILE), "utf8")) as PackageManifest;
}

function exportedBarrels(): ReadonlyMap<string, string> {
    return new Map((readPackageManifest(ROOT).workspaces ?? []).flatMap(workspace => {
        const folder = path.join(ROOT, workspace);
        const {name, exports} = readPackageManifest(folder);
        return Object.entries(exports ?? {}).map(([subpath, target]): [string, string] => [name + subpath.slice(PACKAGE_ROOT_EXPORT.length), path.join(folder, target)]);
    }));
}

const EXPORTED_BARRELS = exportedBarrels();

function typeScriptFilesUnder(directory: string): string[] {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return BUILD_OUTPUT_DIRECTORIES.has(entry.name) ? [] : typeScriptFilesUnder(full);
        return entry.name.endsWith(TYPESCRIPT_EXTENSION) ? [full] : [];
    });
}

function fromRoot(file: string): string {
    return path.relative(ROOT, file).replace(/\\/g, "/");
}

function linesMatching(files: readonly string[], pattern: RegExp): string[] {
    return files.flatMap(file => fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) =>
        pattern.test(line) ? [`${fromRoot(file)}:${index + 1}: ${line.trim()}`] : []));
}

function layerOf(file: string): string | undefined {
    const [top, second, third, fourth] = fromRoot(file).split("/");
    if (top === "src" && (second === "hosts" || second === "backends")) return `${second}/${third}`;
    if (top === "src" && second === "editor" && third === EDITOR_LAUNCH_FOLDER) return "editor launch";
    if (top === "src" && second === "editor" && third === EDITOR_PROJECT_FOLDER) return "editor project";
    if (top === "src") return second;
    if (top === "demo" && third === DEMO_BACKEND_FOLDER) return `demo backend ${fourth}`;
    const generatedBackend = top === "demo" && third === DEMO_GENERATED_FOLDER ? GENERATED_BACKEND_FILE.exec(fourth)?.[1] : undefined;
    if (generatedBackend !== undefined) return `demo backend ${generatedBackend}`;
    if (top === "demo" && third === DEMO_GENERATED_FOLDER && fourth !== undefined) return "demo generated";
    if (top === "demo") return third === DEMO_LAUNCH_ENTRY ? "demo launch" : "demo";
    return undefined;
}

function resolvedImport(importer: string, specifier: string): string | undefined {
    if (specifier.startsWith(PACKAGE_SCOPE)) return EXPORTED_BARRELS.get(specifier);
    const base = path.resolve(path.dirname(importer), specifier);
    return RESOLVE_SUFFIXES.map(suffix => base + suffix).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function layerOfTarget(file: string): string {
    return layerOf(file) ?? fromRoot(file);
}

function wrongDirectionImports(): string[] {
    const importers = [...typeScriptFilesUnder(SRC), ...typeScriptFilesUnder(DEMO)];
    return importers.flatMap(importer => {
        const allowed = ALLOWED_LAYERS[layerOf(importer)!];
        const text = fs.readFileSync(importer, "utf8");
        return [...text.matchAll(SOURCE_IMPORT)].flatMap(match => {
            const target = resolvedImport(importer, match[1]);
            if (target === undefined || allowed.includes(layerOfTarget(target))) return [];
            return [`${fromRoot(importer)} -> ${fromRoot(target)}`];
        });
    }).filter((entry, index, all) => all.indexOf(entry) === index);
}

function specifiersOf(file: string): string[] {
    return [...fs.readFileSync(file, "utf8").matchAll(SOURCE_IMPORT)].map(match => match[1]);
}

function importsOf(file: string): string[] {
    return specifiersOf(file).flatMap(specifier => {
        const target = resolvedImport(file, specifier);
        return target === undefined ? [] : [target];
    });
}

function importClosure(entries: readonly string[]): string[] {
    const reached = [...entries];
    const seen = new Set(reached);
    for (let i = 0; i < reached.length; i++) {
        for (const target of importsOf(reached[i])) {
            if (seen.has(target)) continue;
            seen.add(target);
            reached.push(target);
        }
    }
    return reached;
}

function statementsOtherThanDeclarations(file: string, source: TypeScript.SourceFile, statements: readonly TypeScript.Statement[]): string[] {
    return statements.flatMap(statement => {
        const namespaceBody = ts.isModuleDeclaration(statement) ? statement.body : undefined;
        if (namespaceBody !== undefined && ts.isModuleBlock(namespaceBody)) return statementsOtherThanDeclarations(file, source, namespaceBody.statements);
        if (DECLARATION_STATEMENT_KINDS.has(statement.kind)) return [];
        const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
        return [`${fromRoot(file)}:${line}: ${ts.SyntaxKind[statement.kind]}: ${statement.getText(source).split(LINE_BREAK)[0]}`];
    });
}

function topLevelStatementsOtherThanDeclarations(file: string): string[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    return statementsOtherThanDeclarations(file, source, source.statements);
}

function generatedGameMains(demo: string): string[] {
    const folder = path.join(DEMO, demo, DEMO_GENERATED_FOLDER);
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder)
        .filter(name => name.startsWith(GENERATED_MAIN_PREFIX) && name.endsWith(TYPESCRIPT_EXTENSION) && !name.startsWith(GENERATED_EDITOR_MAIN_PREFIX))
        .map(name => path.join(folder, name));
}

function demoImports(): DemoImport[] {
    return typeScriptFilesUnder(DEMO).flatMap(importer => specifiersOf(importer).map(specifier => ({importer, specifier, target: resolvedImport(importer, specifier)})));
}

function isPackageImport(demoImport: DemoImport): boolean {
    return demoImport.specifier.startsWith(PACKAGE_SCOPE);
}

function describeDemoImport({importer, specifier}: DemoImport): string {
    return `${fromRoot(importer)} -> ${specifier}`;
}

function isSourceBarrel(file: string): boolean {
    return fs.existsSync(file) && path.basename(file) === BARREL_FILE && fromRoot(file).startsWith(SOURCE_PREFIX);
}

function gameEntries(): string[] {
    const demoNames = fs.readdirSync(DEMO, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name);
    const handWrittenEntries = demoNames.map(name => path.join(DEMO, name, DEMO_LAUNCH_ENTRY)).filter(file => fs.existsSync(file));
    return [...demoNames.flatMap(generatedGameMains), ...handWrittenEntries];
}

describe("source rules", () => {
    test("only src/hosts/terminal, src/hosts/desktop and src/toolchain touch node APIs among the non-test files under src/", () => {
        const sourceFiles = typeScriptFilesUnder(SRC).filter(file => !file.endsWith(TEST_SUFFIX));
        const isNodeHost = (file: string) => NODE_API_HOSTS.some(host => fromRoot(file).startsWith(host));
        expect(linesMatching(sourceFiles.filter(file => !isNodeHost(file)), NODE_API_USE)).toEqual([]);
        expect(linesMatching(sourceFiles.filter(isNodeHost), NODE_API_USE).length).toBeGreaterThan(0);
    });

    test("suites import the test harness, never bun:test", () => {
        const suiteFiles = SUITE_ROOTS.flatMap(typeScriptFilesUnder).filter(file => file !== HARNESS);
        expect(linesMatching(suiteFiles, BUN_TEST_IMPORT)).toEqual([]);
    });

    test("imports point engine <- backends <- hosts, backends never import each other, demo game code imports only the engine", () => {
        const found = wrongDirectionImports();
        expect(found.filter(entry => !WRONG_DIRECTION_ALLOWLIST.includes(entry))).toEqual([]);
    });

    test("the cells and pixels backends are separate layers, gpu builds on pixels only, demo backend folders follow them, and every source folder has one", () => {
        expect(ALLOWED_LAYERS["backends/cells"].includes("backends/pixels")).toBe(false);
        expect(ALLOWED_LAYERS["backends/pixels"].includes("backends/cells")).toBe(false);
        expect(ALLOWED_LAYERS["backends/cells"].includes("backends/gpu")).toBe(false);
        expect(ALLOWED_LAYERS["backends/pixels"].includes("backends/gpu")).toBe(false);
        expect(ALLOWED_LAYERS["backends/gpu"].includes("backends/cells")).toBe(false);
        expect(ALLOWED_LAYERS["demo backend cells"].some(layer => layer === "backends/pixels" || layer === "backends/gpu")).toBe(false);
        expect(ALLOWED_LAYERS["demo backend pixels"].some(layer => layer === "backends/cells" || layer === "backends/gpu")).toBe(false);
        expect(ALLOWED_LAYERS["demo backend gpu"].includes("backends/cells")).toBe(false);
        expect(DEMO_BACKENDS.some(layer => ALLOWED_LAYERS["demo"].includes(layer))).toBe(false);
        const layers = new Set([...typeScriptFilesUnder(SRC), ...typeScriptFilesUnder(DEMO)].map(file => layerOf(file)!));
        expect([...layers].filter(layer => ALLOWED_LAYERS[layer] === undefined)).toEqual([]);
    });

    test("terminal input imports only the engine, so the terminal host and the editor's terminal simulation share it", () => {
        expect(ALLOWED_LAYERS[TERMINAL_INPUT]).toEqual(["engine", TERMINAL_INPUT]);
        expect(ALLOWED_LAYERS["hosts/terminal"].includes(TERMINAL_INPUT) && ALLOWED_LAYERS["editor launch"].includes(TERMINAL_INPUT)).toBe(true);
        expect(NODE_API_HOSTS.some(host => `src/${TERMINAL_INPUT}/`.startsWith(host))).toBe(false);
    });

    test("no game entry reaches src/editor through its relative and package imports", () => {
        const entries = gameEntries();
        expect(entries.filter(file => !fs.existsSync(file)).map(fromRoot)).toEqual([]);
        expect(entries.some(file => fromRoot(file).endsWith(`/${DEMO_LAUNCH_ENTRY}`))).toBe(true);
        expect(entries.some(file => path.basename(file).startsWith(GENERATED_MAIN_PREFIX))).toBe(true);
        const reached = importClosure(entries).map(fromRoot);
        expect(reached.includes(ENGINE_WORLD_SOURCE)).toBe(true);
        expect(reached.includes(ENGINE_START_GAME_SOURCE)).toBe(true);
        expect(reached.filter(file => file.startsWith(EDITOR_SOURCES))).toEqual([]);
    });

    test("demo files, generated ones included, import src/ only through the engine packages' exports", () => {
        const imports = demoImports();
        const packageImports = imports.filter(isPackageImport);
        expect(packageImports.length).toBeGreaterThan(0);
        expect(packageImports.filter(({target}) => target === undefined).map(describeDemoImport)).toEqual([]);
        const relativeIntoSource = imports.filter(demoImport => !isPackageImport(demoImport) && demoImport.target !== undefined && fromRoot(demoImport.target).startsWith(SOURCE_PREFIX));
        expect(relativeIntoSource.map(describeDemoImport)).toEqual([]);
    });

    test("every exports target is an index.ts barrel under src/, so the layer rules see a package import as an import of that barrel", () => {
        expect(EXPORTED_BARRELS.size).toBeGreaterThan(0);
        expect([...EXPORTED_BARRELS].filter(([, barrel]) => !isSourceBarrel(barrel)).map(([specifier]) => specifier)).toEqual([]);
    });

    test("src/engine and src/backends run no code when imported: their top-level statements are declarations and exports only", () => {
        const sourceFiles = SIDE_EFFECT_FREE_ROOTS.flatMap(typeScriptFilesUnder).filter(file => !file.endsWith(TEST_SUFFIX));
        const found = sourceFiles.flatMap(topLevelStatementsOtherThanDeclarations);
        expect(found.filter(entry => !TOP_LEVEL_STATEMENT_ALLOWLIST.some(allowed => entry.startsWith(allowed)))).toEqual([]);
    });

    test("every allowlist entry is still a wrong-direction import, so the list only shrinks", () => {
        const found = new Set(wrongDirectionImports());
        expect(WRONG_DIRECTION_ALLOWLIST.filter(entry => !found.has(entry))).toEqual([]);
    });
});
