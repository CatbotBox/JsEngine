import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "fs";
import {dirname, join, resolve} from "path";
import {pathToFileURL} from "url";
import {createProjectServer} from "../src/hosts/desktop";
import type {ProjectServer} from "../src/hosts/desktop";
import {EDITOR_EXTENSIONS_BUNDLE_FILE} from "../src/editor/project/editorExtensions";
import {PROJECT_MANIFEST_FILE} from "../src/engine/project/projectManifest";
import {isBuildSuccess, PROJECT_EDITOR_EXTENSIONS_COPY_PATH, projectApiUrl} from "../src/editor/project/projectServerApi";
import {readPrebuiltProjectCode} from "../src/editor/project/prebuiltProjectCode";
import type {ProjectFileReader} from "../src/editor/project/prebuiltProjectCode";
import type {ProjectManifest} from "../src/engine/project/projectManifest";
import type {BuildProjectResult, OpenProjectResult} from "../src/editor/project/projectServerApi";
import {registerEditorExtensionsOf} from "../src/editor/page/editorExtensionSession";
import {FieldDrawerRegistry} from "../src/editor/page/fieldDrawers";

const ROOT = resolve(__dirname, "..");
const DIST_FLAG = "--dist";
const SERVER_ORIGIN = "http://localhost";
const JSON_HEADERS: Readonly<Record<string, string>> = {"Content-Type": "application/json"};
const FIXTURE_PARENT = join(ROOT, "dist");
const FIXTURE_PREFIX = "editorExtensions-fixture-";
const EXTENSIONS_MODULE = "editor/extensions.ts";
const EXTENSION_MARKER = "fixture-editor-extension";
const DRAWN_TYPE_NAME = "Gradient";
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const QUERY_START = "?";

const MANIFEST: ProjectManifest = {name: "Extensions fixture", editorExtensions: EXTENSIONS_MODULE};
const EXTENSIONS_SOURCE = [
    `import type {EditorExtensions} from "@jsengine/editor/extensions";`,
    ``,
    `const MARKER = "${EXTENSION_MARKER}";`,
    ``,
    `export function registerEditorExtensions(editor: EditorExtensions): void {`,
    `    editor.registerFieldDrawer("${DRAWN_TYPE_NAME}", () => {`,
    `        throw new Error(MARKER);`,
    `    });`,
    `}`,
    ``,
].join("\r\n");
const BROKEN_EXTENSIONS_SOURCE = `export function registerEditorExtensions(editor) {\r\n    editor.registerFieldDrawer(\r\n`;

function log(message: string): void {
    process.stdout.write(message + "\n");
}

let failures = 0;
let bundleImports = 0;
function expect(condition: boolean, label: string): void {
    if (condition) log(`ok   ${label}`);
    else {
        failures++;
        log(`FAIL ${label}`);
    }
}

function writeProjectFile(folder: string, path: string, text: string): void {
    const target = join(folder, ...path.split("/"));
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, text);
}

function serverRequest(server: ProjectServer, route: string, init: RequestInit = {}): Promise<Response> {
    return server.handle(new Request(`${SERVER_ORIGIN}${route}`, init));
}

async function build(server: ProjectServer, id: string): Promise<BuildProjectResult> {
    const response = await serverRequest(server, projectApiUrl(`${encodeURIComponent(id)}/build`), {method: "POST", body: "{}", headers: JSON_HEADERS});
    return await response.json() as BuildProjectResult;
}

async function verifyEditorExtensions(server: ProjectServer, folder: string): Promise<void> {
    writeProjectFile(folder, PROJECT_MANIFEST_FILE, JSON.stringify(MANIFEST, null, 2) + "\n");
    writeProjectFile(folder, EXTENSIONS_MODULE, EXTENSIONS_SOURCE);
    const opened = await (await serverRequest(server, projectApiUrl("open"), {method: "POST", body: JSON.stringify({path: folder}), headers: JSON_HEADERS})).json() as OpenProjectResult;
    expect(opened.validation.ok, `the fixture manifest with "editorExtensions" validates (${JSON.stringify(opened.validation)})`);
    const extensionsRoute = projectApiUrl(`${encodeURIComponent(opened.id)}/${EDITOR_EXTENSIONS_BUNDLE_FILE}`);

    const built = await build(server, opened.id);
    if (!isBuildSuccess(built)) {
        expect(false, `the fixture builds (${JSON.stringify(built)})`);
        return;
    }
    expect(built.warnings.length === 0, `the fixture builds without warnings (${JSON.stringify(built.warnings)})`);
    const url = built.editorExtensionsUrl;
    expect(url !== undefined && url.startsWith(extensionsRoute + QUERY_START), `the build result names the extensions bundle (${url})`);
    const served = await serverRequest(server, url ?? extensionsRoute);
    const source = await served.text();
    expect(served.status === HTTP_OK && source.includes(EXTENSION_MARKER), `GET ${EDITOR_EXTENSIONS_BUNDLE_FILE} serves the bundled module (${served.status})`);

    await expectBundleRegistersDrawer(source, "the bundle's registerEditorExtensions registers its field drawer");

    const copied = join(folder, ...PROJECT_EDITOR_EXTENSIONS_COPY_PATH.split("/"));
    expect(existsSync(copied) && readFileSync(copied, "utf8") === source, `the build copies the extensions bundle into ${PROJECT_EDITOR_EXTENSIONS_COPY_PATH} for a plain-browser folder open`);
    const prebuilt = await readPrebuiltProjectCode(diskReader(folder), MANIFEST, built.gameTarget);
    expect(prebuilt.worker !== undefined && prebuilt.warnings.length === 0, `a plain-browser folder open finds the worker and the extensions (${JSON.stringify(prebuilt.warnings)})`);
    if (prebuilt.editorExtensions !== undefined) {
        await expectBundleRegistersDrawer(new TextDecoder().decode(prebuilt.editorExtensions), "the extensions a plain-browser folder open reads register their field drawer");
    } else {
        expect(false, "a plain-browser folder open reads the extensions bundle");
    }

    writeProjectFile(folder, EXTENSIONS_MODULE, BROKEN_EXTENSIONS_SOURCE);
    const rebuilt = await build(server, opened.id);
    if (!isBuildSuccess(rebuilt)) {
        expect(false, `a broken extensions module does not fail the game build (${JSON.stringify(rebuilt)})`);
        return;
    }
    expect(rebuilt.editorExtensionsUrl === undefined, "a broken extensions module leaves no bundle URL");
    expect(rebuilt.warnings.some(warning => warning.includes("did not build, so the editor runs without them")), `the extensions build error is a warning (${JSON.stringify(rebuilt.warnings)})`);
    expect((await serverRequest(server, extensionsRoute)).status === HTTP_NOT_FOUND, `GET ${EDITOR_EXTENSIONS_BUNDLE_FILE} is a 404 once the bundle is gone`);
    expect(!existsSync(copied), `a build without the extensions bundle removes the stale ${PROJECT_EDITOR_EXTENSIONS_COPY_PATH}`);
}

function diskReader(folder: string): ProjectFileReader {
    return {read: async path => new Uint8Array(readFileSync(join(folder, ...path.split("/"))))};
}

async function expectBundleRegistersDrawer(source: string, label: string): Promise<void> {
    const bundleFile = join(FIXTURE_PARENT, `${FIXTURE_PREFIX}bundle-${process.pid}-${bundleImports++}.mjs`);
    writeFileSync(bundleFile, source);
    try {
        const drawers = new FieldDrawerRegistry();
        const session = await registerEditorExtensionsOf(await import(pathToFileURL(bundleFile).href), drawers);
        expect(drawers.size === 1 && drawers.drawerFor({kind: "custom", typeName: DRAWN_TYPE_NAME}) !== undefined, label);
        session.dispose();
    } finally {
        rmSync(bundleFile, {force: true});
    }
}

async function main(): Promise<void> {
    if (process.argv.includes(DIST_FLAG)) {
        log("editor extensions check: skipped, a built site holds no project bundles");
        return;
    }
    if (process.versions.bun === undefined) {
        log("editor extensions check: skipped, building project bundles needs bun");
        return;
    }
    mkdirSync(FIXTURE_PARENT, {recursive: true});
    const folder = mkdtempSync(join(FIXTURE_PARENT, FIXTURE_PREFIX));
    const server = createProjectServer({repoRoot: ROOT, bun: {path: process.execPath}, browse: false});
    try {
        await verifyEditorExtensions(server, folder);
    } catch (error) {
        expect(false, `editor extensions: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        server.close();
        rmSync(folder, {recursive: true, force: true});
    }
    if (failures > 0) {
        console.error(`${failures} editor extension failures`);
        process.exit(1);
    }
    log("editor extensions OK");
}

void main();
