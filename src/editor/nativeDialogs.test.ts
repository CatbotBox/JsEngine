import {describe, expect, test} from "../engine/testing/harness";
import type * as Fs from "fs";
import type * as Path from "path";

const fs = require("fs") as typeof Fs;
const path = require("path") as typeof Path;

const EDITOR_SOURCES = __dirname;
const ROOT = path.join(__dirname, "..", "..");
const TYPESCRIPT_EXTENSION = ".ts";
const TEST_SUFFIX = ".test.ts";
const NATIVE_DIALOG_CALL = /(?<![\w.$])(?:window\.)?(?:prompt|alert|confirm)\s*\(/;
const LINE_BREAK = /\r?\n/;

function editorSourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return editorSourceFiles(full);
        return entry.name.endsWith(TYPESCRIPT_EXTENSION) && !entry.name.endsWith(TEST_SUFFIX) ? [full] : [];
    });
}

describe("editor dialogs", () => {
    test("the editor asks with its own in-page dialogs, never window.prompt, alert or confirm, which the desktop app does not support", () => {
        const calls = editorSourceFiles(EDITOR_SOURCES).flatMap(file => fs.readFileSync(file, "utf8").split(LINE_BREAK).flatMap((line, index) =>
            NATIVE_DIALOG_CALL.test(line) ? [`${path.relative(ROOT, file).replace(/\\/g, "/")}:${index + 1}: ${line.trim()}`] : []));
        expect(calls).toEqual([]);
    });
});
