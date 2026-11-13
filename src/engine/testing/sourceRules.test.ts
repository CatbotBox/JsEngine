import {describe, expect, test} from "./harness";
import type * as Fs from "fs";
import type * as Path from "path";

const fs = require("fs") as typeof Fs;
const path = require("path") as typeof Path;

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const DEMO = path.join(ROOT, "demo");
const TYPESCRIPT_EXTENSION = ".ts";
const TEST_SUFFIX = ".test.ts";
const BUILD_OUTPUT_DIRECTORIES = new Set(["dist", "dist-prod", "node_modules"]);

const NODE_API_USE = /require\("(fs|path|os|zlib|worker_threads|util|readline)"\)|from "(node:)?(fs|path|os|zlib|worker_threads|util|perf_hooks|timers|readline)"|process\.(stdout|stdin|env)/;
const NODE_API_HOSTS = ["src/hosts/terminal/", "src/hosts/desktop/"];

const BUN_TEST_IMPORT = /from\s+["']bun:test["']|require\(\s*["']bun:test["']\s*\)/;
const HARNESS = path.join(SRC, "engine", "testing", "harness.ts");
const SUITE_ROOTS = [SRC, DEMO];

const RELATIVE_IMPORT = /(?:from|import|require)\s*\(?\s*["'](\.{1,2}(?:\/[^"']*)?)["']/g;
const RESOLVE_SUFFIXES = ["", ".ts", ".js", "/index.ts"];

const BACKENDS = ["backends/cells", "backends/pixels"];

const ALLOWED_LAYERS: Readonly<Record<string, readonly string[]>> = {
    "engine": ["engine"],
    "backends/cells": ["engine", "backends/cells"],
    "backends/pixels": ["engine", "backends/pixels"],
    "hosts/terminal": ["engine", ...BACKENDS, "hosts/terminal"],
    "hosts/web": ["engine", ...BACKENDS, "hosts/web"],
    "hosts/desktop": ["engine", ...BACKENDS, "hosts/desktop"],
    "editor": ["engine", ...BACKENDS, "editor"],
    "editor launch": ["engine", ...BACKENDS, "hosts/web", "editor", "editor launch"],
    "demo": ["engine", "demo"],
    "demo launch": ["engine", ...BACKENDS, "hosts/terminal", "hosts/web", "editor", "demo", "demo launch"],
};

const UNSCHEDULED = "unscheduled";

const WRONG_DIRECTION_ALLOWLIST_REMOVED_IN_STEP: Readonly<Record<string, number | typeof UNSCHEDULED>> = {
    "src/hosts/desktop/main.ts -> scripts/webDistFiles.ts": UNSCHEDULED,
};
const WRONG_DIRECTION_ALLOWLIST = Object.keys(WRONG_DIRECTION_ALLOWLIST_REMOVED_IN_STEP);
const DEMO_LAUNCH_ENTRY = "index.ts";
const DEMO_LAUNCH_FOLDER = "launch";
const EDITOR_LAUNCH_FOLDER = "launch";
const EDITOR_SOURCES = "src/editor/";
const WEB_GAME_ENTRY_NAMES = ["2d", "3d", "swarm", "2d-cells", "2d-pixels", "3d-cells", "3d-pixels", "swarm-cells", "swarm-pixels"];
const DEMO_GAME_ENTRY_PATHS = [["launch", "web.worker.ts"], ["launch", "pixelWeb.worker.ts"], ["index.ts"]];
const ENGINE_WORLD_SOURCE = "src/engine/core/world.ts";

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
    const [top, second, third] = fromRoot(file).split("/");
    if (top === "src" && (second === "hosts" || second === "backends")) return `${second}/${third}`;
    if (top === "src" && second === "editor" && third === EDITOR_LAUNCH_FOLDER) return "editor launch";
    if (top === "src") return second;
    if (top === "demo") return third === DEMO_LAUNCH_ENTRY || third === DEMO_LAUNCH_FOLDER ? "demo launch" : "demo";
    return undefined;
}

function resolvedImport(importer: string, specifier: string): string | undefined {
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
        return [...text.matchAll(RELATIVE_IMPORT)].flatMap(match => {
            const target = resolvedImport(importer, match[1]);
            if (target === undefined || allowed.includes(layerOfTarget(target))) return [];
            return [`${fromRoot(importer)} -> ${fromRoot(target)}`];
        });
    }).filter((entry, index, all) => all.indexOf(entry) === index);
}

function relativeImportsOf(file: string): string[] {
    const text = fs.readFileSync(file, "utf8");
    return [...text.matchAll(RELATIVE_IMPORT)].flatMap(match => {
        const target = resolvedImport(file, match[1]);
        return target === undefined ? [] : [target];
    });
}

function relativeImportClosure(entries: readonly string[]): string[] {
    const reached = [...entries];
    const seen = new Set(reached);
    for (let i = 0; i < reached.length; i++) {
        for (const target of relativeImportsOf(reached[i])) {
            if (seen.has(target)) continue;
            seen.add(target);
            reached.push(target);
        }
    }
    return reached;
}

function gameEntries(): string[] {
    const webEntries = WEB_GAME_ENTRY_NAMES.map(name => path.join(SRC, "hosts", "web", name + TYPESCRIPT_EXTENSION));
    const demoNames = fs.readdirSync(DEMO, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name);
    const demoEntries = demoNames.flatMap(name => DEMO_GAME_ENTRY_PATHS.map(parts => path.join(DEMO, name, ...parts)));
    return [...webEntries, ...demoEntries.filter(file => fs.existsSync(file))];
}

describe("source rules", () => {
    test("only src/hosts/terminal and src/hosts/desktop touch node APIs among the non-test files under src/", () => {
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

    test("the cells and pixels backends are separate layers and every source folder has one", () => {
        expect(ALLOWED_LAYERS["backends/cells"].includes("backends/pixels")).toBe(false);
        expect(ALLOWED_LAYERS["backends/pixels"].includes("backends/cells")).toBe(false);
        const layers = new Set([...typeScriptFilesUnder(SRC), ...typeScriptFilesUnder(DEMO)].map(file => layerOf(file)!));
        expect([...layers].filter(layer => ALLOWED_LAYERS[layer] === undefined)).toEqual([]);
    });

    test("no game entry reaches src/editor through its relative imports", () => {
        const entries = gameEntries();
        expect(entries.filter(file => !fs.existsSync(file)).map(fromRoot)).toEqual([]);
        expect(entries.length).toBeGreaterThan(WEB_GAME_ENTRY_NAMES.length);
        const reached = relativeImportClosure(entries).map(fromRoot);
        expect(reached.includes(ENGINE_WORLD_SOURCE)).toBe(true);
        expect(reached.filter(file => file.startsWith(EDITOR_SOURCES))).toEqual([]);
    });

    test("every allowlist entry is still a wrong-direction import, so the list only shrinks", () => {
        const found = new Set(wrongDirectionImports());
        expect(WRONG_DIRECTION_ALLOWLIST.filter(entry => !found.has(entry))).toEqual([]);
    });
});
