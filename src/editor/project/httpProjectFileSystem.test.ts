import {describe, expect, test} from "../../engine/testing/harness";
import {errorFrames} from "../../engine/debugging/errorStack";
import {HttpProjectFileSystem} from "./httpProjectFileSystem";
import type {HttpFetch, HttpRequestInit, HttpResponseLike, ProjectEventSource} from "./httpProjectFileSystem";
import type {ProjectFileChange} from "./projectFileSystem";

interface RecordedRequest {
    readonly url: string;
    readonly method: string;
    readonly body: string | Uint8Array | undefined;
}

function response(status: number, body: string | Uint8Array): HttpResponseLike {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => new TextDecoder().decode(bytes),
        arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
}

function recordingFetch(answer: (request: RecordedRequest) => HttpResponseLike): {readonly fetch: HttpFetch, readonly requests: RecordedRequest[]} {
    const requests: RecordedRequest[] = [];
    return {
        requests,
        fetch: async (url: string, init?: HttpRequestInit) => {
            const request = {url, method: init?.method ?? "GET", body: init?.body};
            requests.push(request);
            return answer(request);
        },
    };
}

class ScriptedEvents implements ProjectEventSource {
    public readonly listeners = new Map<string, (data: unknown) => void>();

    public on(eventName: string, listener: (data: unknown) => void): () => void {
        this.listeners.set(eventName, listener);
        return () => this.listeners.delete(eventName);
    }
}

describe("HttpProjectFileSystem", () => {
    test("maps each operation onto the project routes, encoding path segments", async () => {
        const {fetch, requests} = recordingFetch(request => request.url.endsWith("/files")
            ? response(200, JSON.stringify([{path: "a b.png", kind: "file", size: 3, mtimeMs: 4}]))
            : response(200, request.method === "GET" ? "abc" : "{}"));
        const files = new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch, events: new ScriptedEvents()});
        expect(await files.list()).toEqual([{path: "a b.png", kind: "file", size: 3, mtimeMs: 4}]);
        expect(await files.readText("dir/a b.png")).toBe("abc");
        await files.write("scenes/main.scene.json", "{}");
        await files.remove("old.txt");
        await files.rename("a.txt", "dir/b.txt");
        await files.makeDirectory("new/folder");
        await files.openExternally("src/game.ts");
        expect(requests.map(request => `${request.method} ${request.url}`)).toEqual([
            "GET /__project/p1/files",
            "GET /__project/p1/file/dir/a%20b.png",
            "PUT /__project/p1/file/scenes/main.scene.json",
            "DELETE /__project/p1/file/old.txt",
            "POST /__project/p1/rename",
            "POST /__project/p1/mkdir",
            "POST /__project/p1/open-external",
        ]);
        expect(requests[2].body).toBe("{}");
        expect(JSON.parse(requests[4].body as string)).toEqual({from: "a.txt", to: "dir/b.txt"});
        expect(JSON.parse(requests[5].body as string)).toEqual({path: "new/folder"});
        expect(JSON.parse(requests[6].body as string)).toEqual({path: "src/game.ts"});
    });

    test("show in folder exists only when the server can show files, and the root is the empty path", async () => {
        const {fetch, requests} = recordingFetch(() => response(200, "{}"));
        expect(new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch, events: new ScriptedEvents()}).showInFolder).toBeUndefined();
        const files = new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch, events: new ScriptedEvents(), showInFolder: true});
        await files.showInFolder?.("art/a.png");
        await files.showInFolder?.("");
        expect(requests.map(request => `${request.method} ${request.url} ${request.body as string}`)).toEqual([
            `POST /__project/p1/show-in-folder {"path":"art/a.png"}`,
            `POST /__project/p1/show-in-folder {"path":""}`,
        ]);
    });

    test("server errors become errors naming the operation and the server's reason", async () => {
        const {fetch} = recordingFetch(() => response(404, JSON.stringify({error: "missing.png is not a file in the project"})));
        const files = new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch, events: new ScriptedEvents()});
        let failure: unknown;
        try {
            await files.read("missing.png");
        } catch (error) {
            failure = error;
        }
        expect(failure instanceof Error && failure.message === "Could not read missing.png: missing.png is not a file in the project").toBe(true);
    });

    test("a server error with a stack keeps the server's frames on the error", async () => {
        const serverFrames = "    at readProjectFile (projectServer.ts:610:11)";
        const {fetch} = recordingFetch(() => response(500, JSON.stringify({error: "EBUSY: resource busy", stack: serverFrames})));
        const files = new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch, events: new ScriptedEvents()});
        let failure: unknown;
        try {
            await files.write("level.scene.json", "{}");
        } catch (error) {
            failure = error;
        }
        expect(failure instanceof Error ? failure.message : failure).toBe("Could not write level.scene.json: EBUSY: resource busy");
        expect(failure instanceof Error ? errorFrames(failure) : undefined).toBe(serverFrames);
    });

    test("paths leaving the project are refused before any request", async () => {
        const {fetch, requests} = recordingFetch(() => response(200, "{}"));
        const files = new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch, events: new ScriptedEvents()});
        let failure: unknown;
        try {
            await files.write("../escape.txt", "x");
        } catch (error) {
            failure = error;
        }
        expect(failure instanceof Error && failure.message.includes("is not a path inside the project folder")).toBe(true);
        expect(requests.length).toBe(0);
    });

    test("onChange follows files-changed server events and ignores malformed ones", () => {
        const events = new ScriptedEvents();
        const files = new HttpProjectFileSystem({projectId: "p1", rootLabel: "game", fetch: recordingFetch(() => response(200, "")).fetch, events});
        const changes: ProjectFileChange[] = [];
        const stop = files.onChange(change => changes.push(change));
        const deliver = events.listeners.get("files-changed")!;
        deliver({paths: ["a.png"]});
        deliver({paths: "a.png"});
        stop();
        expect(changes).toEqual([{paths: ["a.png"]}]);
        expect(events.listeners.has("files-changed")).toBe(false);
    });
});
