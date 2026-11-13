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

const ALLOWED_LAYERS: Readonly<Record<string, readonly string[]>> = {
    "engine": ["engine"],
    "backends": ["engine", "backends"],
    "hosts/terminal": ["engine", "backends", "hosts/terminal"],
    "hosts/web": ["engine", "backends", "hosts/web"],
    "hosts/desktop": ["engine", "backends", "hosts/desktop"],
    "editor": ["engine", "backends", "editor"],
    "demo": ["engine", "demo"],
    "demo launch": ["engine", "backends", "hosts/terminal", "demo"],
};

const UNSCHEDULED = "unscheduled";

const STEP_1_ALLOWLIST_REMOVED_IN_STEP: Readonly<Record<string, number | typeof UNSCHEDULED>> = {
    "src/engine/rendering/textSprite.ts -> src/backends/cells/ansiEncoding.ts": 4,
    "src/engine/rendering/textSprite.test.ts -> src/backends/cells/ansiEncoding.ts": 4,
    "demo/2d/game.ts -> src/backends/cells/index.ts": 4,
    "demo/2d/game.ts -> src/backends/cells/2d/index.ts": 4,
    "demo/3d/game.ts -> src/backends/cells/index.ts": 4,
    "demo/3d/game.ts -> src/backends/cells/3d/index.ts": 4,
    "src/hosts/web/world2d.worker.ts -> demo/2d/game.ts": UNSCHEDULED,
    "src/hosts/web/world3d.worker.ts -> demo/3d/game.ts": UNSCHEDULED,
    "src/hosts/web/world3d.worker.ts -> demo/3d/assets.ts": UNSCHEDULED,
    "src/hosts/desktop/main.ts -> scripts/webDistFiles.ts": UNSCHEDULED,
};
const STEP_1_ALLOWLIST = Object.keys(STEP_1_ALLOWLIST_REMOVED_IN_STEP);

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
    if (top === "src" && second === "hosts") return `hosts/${third}`;
    if (top === "src") return second;
    if (top === "demo") return third === "index.ts" ? "demo launch" : "demo";
    return undefined;
}

function resolvedImport(importer: string, specifier: string): string | undefined {
    const base = path.resolve(path.dirname(importer), specifier);
    return RESOLVE_SUFFIXES.map(suffix => base + suffix).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function layerOfTarget(file: string): string {
    const layer = layerOf(file);
    return layer === "demo launch" ? "demo" : layer ?? fromRoot(file);
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

    test("imports point engine <- backends <- hosts, demo game code imports only the engine", () => {
        const found = wrongDirectionImports();
        expect(found.filter(entry => !STEP_1_ALLOWLIST.includes(entry))).toEqual([]);
    });

    test("every step 1 allowlist entry is still a wrong-direction import, so the list only shrinks", () => {
        const found = new Set(wrongDirectionImports());
        expect(STEP_1_ALLOWLIST.filter(entry => !found.has(entry))).toEqual([]);
    });
});
