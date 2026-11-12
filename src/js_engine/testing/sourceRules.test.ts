import {describe, expect, test} from "./harness";
import type * as Fs from "fs";
import type * as Path from "path";

const fs = require("fs") as typeof Fs;
const path = require("path") as typeof Path;

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const TYPESCRIPT_EXTENSION = ".ts";
const TEST_SUFFIX = ".test.ts";
const BUILD_OUTPUT_DIRECTORIES = new Set(["dist", "dist-prod", "node_modules"]);

const NODE_API_USE = /require\("(fs|path|os|zlib|worker_threads|util|readline)"\)|from "(node:)?(fs|path|os|zlib|worker_threads|util|perf_hooks|timers|readline)"|process\.(stdout|stdin|env)/;
const NODE_API_HOST = path.join(SRC, "js_engine", "platform", "nodePlatform.ts");

const BUN_TEST_IMPORT = /from\s+["']bun:test["']|require\(\s*["']bun:test["']\s*\)/;
const HARNESS = path.join(SRC, "js_engine", "testing", "harness.ts");
const SUITE_ROOTS = ["src", "demo", "web"].map(name => path.join(ROOT, name));

function typeScriptFilesUnder(directory: string): string[] {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return BUILD_OUTPUT_DIRECTORIES.has(entry.name) ? [] : typeScriptFilesUnder(full);
        return entry.name.endsWith(TYPESCRIPT_EXTENSION) ? [full] : [];
    });
}

function linesMatching(files: readonly string[], pattern: RegExp): string[] {
    return files.flatMap(file => fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) =>
        pattern.test(line) ? [`${path.relative(ROOT, file).replace(/\\/g, "/")}:${index + 1}: ${line.trim()}`] : []));
}

describe("source rules", () => {
    test("only nodePlatform.ts touches node APIs among the non-test files under src/", () => {
        const engineFiles = typeScriptFilesUnder(SRC).filter(file => !file.endsWith(TEST_SUFFIX) && file !== NODE_API_HOST);
        expect(linesMatching(engineFiles, NODE_API_USE)).toEqual([]);
        expect(linesMatching([NODE_API_HOST], NODE_API_USE).length).toBeGreaterThan(0);
    });

    test("suites import the test harness, never bun:test", () => {
        const suiteFiles = SUITE_ROOTS.flatMap(typeScriptFilesUnder).filter(file => file !== HARNESS);
        expect(linesMatching(suiteFiles, BUN_TEST_IMPORT)).toEqual([]);
    });
});
