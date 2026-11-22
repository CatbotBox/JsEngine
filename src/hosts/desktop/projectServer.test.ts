import {afterEach, beforeEach, describe, expect, test} from "../../engine/testing/harness";
import type * as Fs from "fs";
import type * as Os from "os";
import type * as Path from "path";
import {createProjectServer, externalOpenCommand, splitCommandLine} from "./projectServer";
import type {ProjectServer, ToolchainOutput} from "./projectServer";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {STARTER_SCENE_FILE} from "../../editor/project/projectTemplate";
import {EDITOR_SETTINGS_FILE} from "../../editor/project/editorSettings";
import type {GameTarget} from "../../editor/project/editorSettings";
import {EDITOR_SETTINGS_UPDATE_METHOD} from "../../editor/project/projectServerApi";
import type {OpenProjectResult, PackageResult, TargetFeatureReport, TargetReportResult} from "../../editor/project/projectServerApi";
import type {ProjectTarget} from "../../engine/project/projectTargets";

const fs = require("fs") as typeof Fs;
const os = require("os") as typeof Os;
const path = require("path") as typeof Path;

const ORIGIN = "http://localhost:8080";
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_CONFLICT = 409;
const TERMINAL: GameTarget = {target: "terminal", backend: "cells"};
const WINDOW_GPU: GameTarget = {target: "window", backend: "gpu"};
const BUN_STUB = "bun-stub";
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const UNAVAILABLE_REASON = "building project code needs the JsEngine source tree; start the editor from the repository";
const DOM_PROBLEM_REPORT: TargetFeatureReport = {
    ok: false,
    target: "terminal",
    bundles: [{
        bundle: "game terminal",
        target: "terminal",
        modules: 12,
        problems: [{symbol: "document", file: "src/hud.ts", line: 4, column: 9, missing: {anyOf: [], allOf: ["dom"]}, chain: ["src/main.ts", "src/hud.ts"]}],
    }],
    errors: [],
};

let folder = "";
let server: ProjectServer;
let openedExternally: string[] = [];

function request(route: string, init: RequestInit = {}): Promise<Response> {
    return server.handle(new Request(`${ORIGIN}/__project/${route}`, init));
}

function post(route: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return request(route, {method: "POST", body: JSON.stringify(body), headers: {"Content-Type": "application/json", ...headers}});
}

function patch(route: string, body: unknown): Promise<Response> {
    return request(route, {method: EDITOR_SETTINGS_UPDATE_METHOD, body: JSON.stringify(body), headers: {"Content-Type": "application/json"}});
}

async function opened(target: string): Promise<OpenProjectResult> {
    return await (await post("open", {path: target})).json() as OpenProjectResult;
}

function serverWithToolchain(respond: (args: readonly string[]) => Promise<ToolchainOutput>): string[][] {
    server.close();
    const runs: string[][] = [];
    server = createProjectServer({repoRoot: folder, bun: {path: BUN_STUB}, browse: false, allowedHostnames: ["localhost"], runToolchain: async (_repoRoot, _bunPath, args) => {
        runs.push([...args]);
        return await respond(args);
    }});
    return runs;
}

function passingReport(target: ProjectTarget): TargetFeatureReport {
    return {ok: true, target, bundles: [{bundle: `${target}.js`, target, modules: 3, problems: []}], errors: []};
}

function requestedTargetOf(args: readonly string[]): ProjectTarget {
    return args[args.indexOf("--target") + 1] as ProjectTarget;
}

async function targetReport(id: string, target: unknown): Promise<TargetReportResult> {
    return await (await post(`${id}/target-report`, {target})).json() as TargetReportResult;
}

function nextTask(): Promise<void> {
    return new Promise(resolveTask => setTimeout(resolveTask, 0));
}

async function packaged(id: string): Promise<PackageResult> {
    return await (await post(`${id}/package`, {})).json() as PackageResult;
}

beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "jsengine-project-"));
    openedExternally = [];
    server = createProjectServer({
        bun: {unavailableReason: "no bun in tests"},
        browse: true,
        allowedHostnames: ["localhost"],
        openExternally: async absolutePath => {
            openedExternally.push(absolutePath);
        },
    });
});

afterEach(() => {
    server.close();
    fs.rmSync(folder, {recursive: true, force: true});
});

describe("project server", () => {
    test("capabilities say why building is unavailable", async () => {
        const capabilities = await (await request("capabilities")).json();
        expect(capabilities.build).toBe(false);
        expect(capabilities.pickFolder).toBe(false);
        expect(capabilities.browse).toBe(true);
        expect(typeof capabilities.buildUnavailableReason).toBe("string");
    });

    test("an empty folder opens with problems, create writes the starter files and refuses to overwrite them", async () => {
        const empty = await opened(folder);
        expect(empty.validation.ok).toBe(false);
        const created = await (await post("create", {path: folder, name: "Starter"})).json() as OpenProjectResult;
        expect(created.validation).toEqual({ok: true, manifest: {name: "Starter", startScene: STARTER_SCENE_FILE}});
        expect(created.id).toBe(empty.id);
        expect(fs.existsSync(path.join(folder, PROJECT_MANIFEST_FILE))).toBe(true);
        const again = await post("create", {path: folder, name: "Starter"});
        expect(again.status).toBe(HTTP_CONFLICT);
        expect((await again.json()).error.includes(PROJECT_MANIFEST_FILE)).toBe(true);
    });

    test("files can be listed, written, read, renamed and removed inside the folder", async () => {
        const {id} = await opened(folder);
        expect((await request(`${id}/file/assets/a%20b.txt`, {method: "PUT", body: "hello"})).status).toBe(HTTP_OK);
        expect((await post(`${id}/mkdir`, {path: "empty/inner"})).status).toBe(HTTP_OK);
        expect(await (await request(`${id}/file/assets/a%20b.txt`)).text()).toBe("hello");
        expect((await post(`${id}/rename`, {from: "assets/a b.txt", to: "moved/c.txt"})).status).toBe(HTTP_OK);
        const listing = await (await request(`${id}/files`)).json() as {path: string, kind: string, size: number}[];
        expect(listing.map(entry => `${entry.kind} ${entry.path} ${entry.size}`)).toEqual([
            "directory assets 0",
            "directory empty 0",
            "directory empty/inner 0",
            "directory moved 0",
            "file moved/c.txt 5",
        ]);
        expect((await request(`${id}/file/moved`, {method: "DELETE"})).status).toBe(HTTP_OK);
        expect((await request(`${id}/file/moved/c.txt`)).status).toBe(HTTP_NOT_FOUND);
    });

    test("paths that leave the folder are refused", async () => {
        const {id} = await opened(folder);
        for (const route of [`${id}/file/..%2Fescape.txt`, `${id}/file/..%5Cescape.txt`, `${id}/file/C%3A%2Fescape.txt`, `${id}/file/%2Fescape.txt`]) {
            expect((await request(route, {method: "PUT", body: "x"})).status).toBe(HTTP_BAD_REQUEST);
        }
        expect((await request(`${id}/file/a/%2E%2E/%2E%2E/escape.txt`, {method: "PUT", body: "x"})).ok).toBe(false);
        expect((await post(`${id}/rename`, {from: "a.txt", to: "../b.txt"})).status).toBe(HTTP_BAD_REQUEST);
        expect(fs.existsSync(path.join(folder, "..", "escape.txt"))).toBe(false);
    });

    test("open-external hands the launcher the absolute path of a file inside the folder only", async () => {
        const {id} = await opened(folder);
        await request(`${id}/file/src/game.ts`, {method: "PUT", body: "export {};"});
        expect((await post(`${id}/open-external`, {path: "src/game.ts"})).status).toBe(HTTP_OK);
        expect(openedExternally).toEqual([path.join(fs.realpathSync(folder), "src", "game.ts")]);
        for (const escaping of ["../escape.ts", "..\\escape.ts", "src/../../escape.ts", "C:/Windows/notepad.exe", "/etc/passwd"]) {
            expect((await post(`${id}/open-external`, {path: escaping})).status).toBe(HTTP_BAD_REQUEST);
        }
        expect((await post(`${id}/open-external`, {path: "src/missing.ts"})).status).toBe(HTTP_NOT_FOUND);
        expect((await post(`${id}/open-external`, {path: "src"})).status).toBe(HTTP_NOT_FOUND);
        expect((await post(`${id}/open-external`, {})).status).toBe(HTTP_BAD_REQUEST);
        expect((await request(`${id}/open-external`)).status).toBe(HTTP_METHOD_NOT_ALLOWED);
        expect((await post(`${id}/open-external`, {path: "src/game.ts"}, {Origin: "http://evil.example"})).status).toBe(HTTP_FORBIDDEN);
        expect(openedExternally.length).toBe(1);
    });

    test("show-in-folder is a capability only a host with a file manager hook has", async () => {
        expect((await (await request("capabilities")).json()).showInFolder).toBe(false);
        const {id} = await opened(folder);
        expect((await post(`${id}/show-in-folder`, {path: ""})).status).toBe(HTTP_NOT_FOUND);
        server.close();
        const shown: string[] = [];
        server = createProjectServer({bun: {unavailableReason: "no bun in tests"}, browse: false, allowedHostnames: ["localhost"], showInFolder: async absolutePath => {
            shown.push(absolutePath);
        }});
        expect((await (await request("capabilities")).json()).showInFolder).toBe(true);
        const reopened = await opened(folder);
        await request(`${reopened.id}/file/art/a.png`, {method: "PUT", body: "png"});
        expect((await post(`${reopened.id}/show-in-folder`, {path: "art/a.png"})).status).toBe(HTTP_OK);
        expect((await post(`${reopened.id}/show-in-folder`, {path: "art"})).status).toBe(HTTP_OK);
        expect((await post(`${reopened.id}/show-in-folder`, {path: ""})).status).toBe(HTTP_OK);
        expect((await post(`${reopened.id}/show-in-folder`, {path: "art/missing.png"})).status).toBe(HTTP_NOT_FOUND);
        expect((await post(`${reopened.id}/show-in-folder`, {path: "../escape"})).status).toBe(HTTP_BAD_REQUEST);
        expect((await post(`${reopened.id}/show-in-folder`, {})).status).toBe(HTTP_BAD_REQUEST);
        const root = fs.realpathSync(folder);
        expect(shown.map(shownPath => fs.realpathSync(shownPath))).toEqual([path.join(root, "art", "a.png"), path.join(root, "art"), root]);
    });

    test("a link pointing outside the folder is not followed", async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "jsengine-outside-"));
        try {
            try {
                fs.symlinkSync(outside, path.join(folder, "link"), "junction");
            } catch {
                return;
            }
            const {id} = await opened(folder);
            expect((await request(`${id}/file/link/secret.txt`, {method: "PUT", body: "x"})).status).toBe(HTTP_FORBIDDEN);
            expect(fs.existsSync(path.join(outside, "secret.txt"))).toBe(false);
            const listing = await (await request(`${id}/files`)).json() as {path: string}[];
            expect(listing.some(entry => entry.path.startsWith("link"))).toBe(false);
        } finally {
            fs.rmSync(outside, {recursive: true, force: true});
        }
    });

    test("requests from another origin or host are refused", async () => {
        const {id} = await opened(folder);
        expect((await post(`${id}/mkdir`, {path: "x"}, {Origin: "http://evil.example"})).status).toBe(HTTP_FORBIDDEN);
        expect((await post(`${id}/mkdir`, {path: "x"}, {Origin: ORIGIN})).status).toBe(HTTP_OK);
        const rebound = await server.handle(new Request("http://attacker.example:8080/__project/capabilities"));
        expect(rebound.status).toBe(HTTP_FORBIDDEN);
    });

    test("unknown ids, routes and methods are errors with a reason", async () => {
        expect((await request("nope/files")).status).toBe(HTTP_NOT_FOUND);
        const {id} = await opened(folder);
        expect((await request(`${id}/files`, {method: "DELETE"})).status).toBe(HTTP_METHOD_NOT_ALLOWED);
        expect((await request(`${id}/worker.js`)).status).toBe(HTTP_NOT_FOUND);
        const extensions = await request(`${id}/editor-extensions.js`);
        expect(extensions.status).toBe(HTTP_NOT_FOUND);
        expect((await extensions.json()).error).toBe(`this project has no editor extensions bundle: name a module in "editorExtensions" in ${PROJECT_MANIFEST_FILE} and build it`);
        expect((await request(`${id}/editor-extensions.js`, {method: "POST"})).status).toBe(HTTP_METHOD_NOT_ALLOWED);
        const build = await post(`${id}/build`, {});
        expect(build.status).toBe(HTTP_OK);
        expect(await build.json()).toEqual({errors: ["building project code needs the JsEngine source tree; start the editor from the repository"]});
    });

    test("generate reports why it cannot run where building is unavailable, and takes only POST", async () => {
        const {id} = await opened(folder);
        const generated = await post(`${id}/generate`, {});
        expect(generated.status).toBe(HTTP_OK);
        expect(await generated.json()).toEqual({ok: false, errors: ["building project code needs the JsEngine source tree; start the editor from the repository"]});
        expect((await request(`${id}/generate`)).status).toBe(HTTP_METHOD_NOT_ALLOWED);
    });

    test("editor settings read as nothing until saved, then live in .jsengine/editor.json beside the keys they do not own", async () => {
        const {id} = await opened(folder);
        const route = `${id}/editor-settings`;
        const settingsFile = path.join(folder, EDITOR_SETTINGS_FILE);
        expect(await (await request(route)).json()).toEqual({});
        const saved = await patch(route, {gameTarget: TERMINAL});
        expect(saved.status).toBe(HTTP_OK);
        expect(await saved.json()).toEqual({gameTarget: TERMINAL});
        expect(JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({gameTarget: TERMINAL});
        fs.writeFileSync(settingsFile, JSON.stringify({panels: {bottom: 200}, gameTarget: TERMINAL}));
        expect((await patch(route, {gameTarget: WINDOW_GPU})).status).toBe(HTTP_OK);
        expect(JSON.parse(fs.readFileSync(settingsFile, "utf8"))).toEqual({panels: {bottom: 200}, gameTarget: WINDOW_GPU});
        expect(await (await request(route)).json()).toEqual({gameTarget: WINDOW_GPU});
    });

    test("editor settings refuse targets the editor does not simulate, unknown settings and other methods; a broken file reads as nothing", async () => {
        const {id} = await opened(folder);
        const route = `${id}/editor-settings`;
        const unsupported = await patch(route, {gameTarget: {target: "window", backend: "cells"}});
        expect(unsupported.status).toBe(HTTP_BAD_REQUEST);
        expect((await unsupported.json()).error.includes("terminal cells")).toBe(true);
        expect((await patch(route, {theme: "dark"})).status).toBe(HTTP_BAD_REQUEST);
        expect((await post(route, {gameTarget: TERMINAL})).status).toBe(HTTP_METHOD_NOT_ALLOWED);
        expect(fs.existsSync(path.join(folder, EDITOR_SETTINGS_FILE))).toBe(false);
        fs.mkdirSync(path.dirname(path.join(folder, EDITOR_SETTINGS_FILE)), {recursive: true});
        fs.writeFileSync(path.join(folder, EDITOR_SETTINGS_FILE), "{not json");
        expect(await (await request(route)).json()).toEqual({});
        fs.writeFileSync(path.join(folder, EDITOR_SETTINGS_FILE), JSON.stringify({gameTarget: {target: "terminal", backend: "gpu"}}));
        expect(await (await request(route)).json()).toEqual({});
    });

    test("browse lists folders and drive or root shortcuts", async () => {
        fs.mkdirSync(path.join(folder, "child"));
        fs.mkdirSync(path.join(folder, ".hidden"));
        const browsed = await (await request(`browse?path=${encodeURIComponent(folder)}`)).json();
        expect(browsed.directories.map((directory: {name: string}) => directory.name)).toEqual(["child"]);
        expect(browsed.parent).toBe(path.dirname(folder));
        expect(browsed.roots.length).toBeGreaterThan(1);
    });
});

describe("project server target builds", () => {
    test("a target report runs jsengine build with --project for the terminal only, and splits the report from the other output", async () => {
        const runs = serverWithToolchain(async args => {
            const target = requestedTargetOf(args);
            const report = target === "terminal" ? DOM_PROBLEM_REPORT : passingReport(target);
            return {stdout: `warning: ${target} note\n${JSON.stringify(report)}\n`, stderr: "bundled\r\n", exitCode: report.ok ? EXIT_SUCCESS : EXIT_FAILURE};
        });
        const {id, path: projectFolder} = await opened(folder);
        expect(await targetReport(id, "terminal")).toEqual({report: DOM_PROBLEM_REPORT, output: ["warning: terminal note", "bundled"]});
        expect(await targetReport(id, "web")).toEqual({report: passingReport("web"), output: ["warning: web note", "bundled"]});
        expect(runs).toEqual([
            ["build", "--target", "terminal", "--report", "json", "--project", projectFolder],
            ["build", "--target", "web", "--report", "json"],
        ]);
    });

    test("a run that prints no report becomes a failed report carrying what the CLI said", async () => {
        serverWithToolchain(async () => ({stdout: "regenerate generated/\n", stderr: "jsengine: the window build covers every demo; drop --project\n", exitCode: EXIT_USAGE}));
        const {id} = await opened(folder);
        expect(await targetReport(id, "window")).toEqual({
            report: {ok: false, target: "window", bundles: [], errors: [`jsengine build --target window exited with ${EXIT_USAGE}:`, "jsengine: the window build covers every demo; drop --project"]},
            output: ["regenerate generated/"],
        });
        serverWithToolchain(async () => ({stdout: "", stderr: "", exitCode: EXIT_FAILURE}));
        const reopened = await opened(folder);
        expect((await targetReport(reopened.id, "web")).report.errors).toEqual([`jsengine build --target web exited with ${EXIT_FAILURE} and no report`]);
        serverWithToolchain(async () => {
            throw new Error("spawn failed");
        });
        const failedSpawn = await opened(folder);
        expect((await targetReport(failedSpawn.id, "web")).report.errors).toEqual([`Could not run ${BUN_STUB}: spawn failed`]);
    });

    test("a report for another target than the one asked for is not trusted", async () => {
        serverWithToolchain(async () => ({stdout: JSON.stringify(passingReport("web")), stderr: "", exitCode: EXIT_SUCCESS}));
        const {id} = await opened(folder);
        expect((await targetReport(id, "window")).report.ok).toBe(false);
    });

    test("target reports take a known target and only POST", async () => {
        const runs = serverWithToolchain(async () => ({stdout: "", stderr: "", exitCode: EXIT_SUCCESS}));
        const {id} = await opened(folder);
        const unknown = await post(`${id}/target-report`, {target: "editor"});
        expect(unknown.status).toBe(HTTP_BAD_REQUEST);
        expect((await unknown.json()).error).toBe(`"target" must be one of web, window, terminal`);
        expect((await post(`${id}/target-report`, {})).status).toBe(HTTP_BAD_REQUEST);
        expect((await request(`${id}/target-report`)).status).toBe(HTTP_METHOD_NOT_ALLOWED);
        expect((await request(`${id}/package`)).status).toBe(HTTP_METHOD_NOT_ALLOWED);
        expect(runs).toEqual([]);
    });

    test("package runs jsengine package for the window target and passes its output and exit status back", async () => {
        let exitCode = EXIT_SUCCESS;
        const runs = serverWithToolchain(async () => ({stdout: "packaged release/swarm\n", stderr: "", exitCode}));
        const {id, path: projectFolder} = await opened(folder);
        expect(await packaged(id)).toEqual({ok: true, output: ["packaged release/swarm"]});
        exitCode = EXIT_USAGE;
        expect(await packaged(id)).toEqual({ok: false, output: ["packaged release/swarm"]});
        expect(runs).toEqual([
            ["package", "--target", "window", "--project", projectFolder],
            ["package", "--target", "window", "--project", projectFolder],
        ]);
    });

    test("target builds and packaging run one at a time across the server", async () => {
        const pending: (() => void)[] = [];
        const runs = serverWithToolchain(args => new Promise(resolveRun => {
            pending.push(() => resolveRun({stdout: JSON.stringify(passingReport(requestedTargetOf(args))), stderr: "", exitCode: EXIT_SUCCESS}));
        }));
        const {id} = await opened(folder);
        const both = Promise.all([targetReport(id, "web"), packaged(id)]);
        await nextTask();
        expect(runs.length).toBe(1);
        pending[0]();
        await nextTask();
        expect(runs.length).toBe(2);
        pending[1]();
        const [web, packaging] = await both;
        expect(web.report.ok).toBe(true);
        expect(packaging.ok).toBe(true);
    });

    test("target builds and packaging say why they cannot run where building is unavailable", async () => {
        const {id} = await opened(folder);
        expect(await targetReport(id, "web")).toEqual({report: {ok: false, target: "web", bundles: [], errors: [UNAVAILABLE_REASON]}, output: []});
        expect(await packaged(id)).toEqual({ok: false, output: [UNAVAILABLE_REASON]});
    });
});

describe("external editor command", () => {
    const file = "/project/src/game.ts";

    test("JSENGINE_EDITOR wins over VISUAL and EDITOR, and its quoted parts stay whole", () => {
        expect(externalOpenCommand(file, {JSENGINE_EDITOR: `"C:\\Program Files\\Editor\\editor.exe" --reuse-window`, VISUAL: "vim", EDITOR: "nano"}, "win32"))
            .toEqual({command: "C:\\Program Files\\Editor\\editor.exe", args: ["--reuse-window", file]});
        expect(externalOpenCommand(file, {VISUAL: "subl -w", EDITOR: "nano"}, "linux")).toEqual({command: "subl", args: ["-w", file]});
        expect(externalOpenCommand(file, {JSENGINE_EDITOR: "  ", EDITOR: "nano"}, "linux")).toEqual({command: "nano", args: [file]});
    });

    test("without an editor variable the platform's default handler opens the file", () => {
        expect(externalOpenCommand(file, {}, "win32")).toEqual({command: "explorer.exe", args: [file]});
        expect(externalOpenCommand(file, {}, "darwin")).toEqual({command: "open", args: [file]});
        expect(externalOpenCommand(file, {}, "linux")).toEqual({command: "xdg-open", args: [file]});
    });

    test("command lines split on unquoted whitespace", () => {
        expect(splitCommandLine(`code  --wait 'a b' "" x"y z"w`)).toEqual(["code", "--wait", "a b", "", "xy zw"]);
        expect(splitCommandLine("   ")).toEqual([]);
    });
});
