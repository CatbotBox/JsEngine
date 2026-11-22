import {describe, expect, test} from "../../engine/testing/harness";
import type {ProjectManifest} from "../../engine/project/projectManifest";
import type {GameTarget} from "./editorSettings";
import {missingEditorExtensionsWarning, readPrebuiltProjectCode} from "./prebuiltProjectCode";
import type {ProjectFileReader} from "./prebuiltProjectCode";
import {PROJECT_EDITOR_EXTENSIONS_COPY_PATH, projectBuildCopyPath} from "./projectServerApi";

const WEB_PIXELS: GameTarget = {target: "web", backend: "pixels"};
const EXTENSIONS_MODULE = "editor/extensions.ts";
const PLAIN_MANIFEST: ProjectManifest = {name: "Game"};
const EXTENDED_MANIFEST: ProjectManifest = {name: "Game", editorExtensions: EXTENSIONS_MODULE};
const WORKER_BYTES = new Uint8Array([1, 2, 3]);
const EXTENSIONS_BYTES = new Uint8Array([4, 5]);

function filesHolding(contents: Readonly<Record<string, Uint8Array>>): ProjectFileReader & {readonly reads: string[]} {
    const reads: string[] = [];
    return {
        reads,
        read: async path => {
            reads.push(path);
            const bytes = contents[path];
            if (bytes === undefined) throw new Error(`${path} is not a file in the project`);
            return bytes;
        },
    };
}

describe("prebuilt project code", () => {
    test("reads the target's worker and the editor extensions bundled beside it", async () => {
        const files = filesHolding({[projectBuildCopyPath(WEB_PIXELS)]: WORKER_BYTES, [PROJECT_EDITOR_EXTENSIONS_COPY_PATH]: EXTENSIONS_BYTES});
        const code = await readPrebuiltProjectCode(files, EXTENDED_MANIFEST, WEB_PIXELS);
        expect(code).toEqual({workerPath: projectBuildCopyPath(WEB_PIXELS), worker: WORKER_BYTES, editorExtensions: EXTENSIONS_BYTES, warnings: []});
    });

    test("a manifest without editorExtensions never loads a left-over extensions bundle", async () => {
        const files = filesHolding({[projectBuildCopyPath(WEB_PIXELS)]: WORKER_BYTES, [PROJECT_EDITOR_EXTENSIONS_COPY_PATH]: EXTENSIONS_BYTES});
        const code = await readPrebuiltProjectCode(files, PLAIN_MANIFEST, WEB_PIXELS);
        expect([code.editorExtensions, code.warnings]).toEqual([undefined, []]);
        expect(files.reads).toEqual([projectBuildCopyPath(WEB_PIXELS)]);
    });

    test("named but unbundled extensions are a warning, and a missing worker reads as undefined", async () => {
        const code = await readPrebuiltProjectCode(filesHolding({}), EXTENDED_MANIFEST, WEB_PIXELS);
        expect(code).toEqual({workerPath: projectBuildCopyPath(WEB_PIXELS), worker: undefined, editorExtensions: undefined, warnings: [missingEditorExtensionsWarning(EXTENSIONS_MODULE)]});
    });
});
