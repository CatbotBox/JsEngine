import {afterEach, beforeEach, describe, expect, test} from "../../engine/testing/harness";
import type * as Fs from "fs";
import type * as Os from "os";
import type * as Path from "path";
import {createProjectServer, externalOpenCommand, splitCommandLine} from "./projectServer";
import type {ProjectServer} from "./projectServer";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {STARTER_SCENE_FILE} from "../../editor/project/projectTemplate";
import type {OpenProjectResult} from "../../editor/project/projectServerApi";

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

let folder = "";
let server: ProjectServer;
let openedExternally: string[] = [];

function request(route: string, init: RequestInit = {}): Promise<Response> {
    return server.handle(new Request(`${ORIGIN}/__project/${route}`, init));
}

function post(route: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return request(route, {method: "POST", body: JSON.stringify(body), headers: {"Content-Type": "application/json", ...headers}});
}

async function opened(target: string): Promise<OpenProjectResult> {
    return await (await post("open", {path: target})).json() as OpenProjectResult;
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

    test("browse lists folders and drive or root shortcuts", async () => {
        fs.mkdirSync(path.join(folder, "child"));
        fs.mkdirSync(path.join(folder, ".hidden"));
        const browsed = await (await request(`browse?path=${encodeURIComponent(folder)}`)).json();
        expect(browsed.directories.map((directory: {name: string}) => directory.name)).toEqual(["child"]);
        expect(browsed.parent).toBe(path.dirname(folder));
        expect(browsed.roots.length).toBeGreaterThan(1);
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
