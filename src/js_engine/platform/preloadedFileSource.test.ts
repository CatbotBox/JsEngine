import {describe, expect, test} from "../testing/harness";
import {PreloadedFileSource} from "./preloadedFileSource";
import {MemoryFileSource} from "./memoryPlatform";
import type {FetchedFile} from "./preloadedFileSource";
import {Mesh} from "../rendering/3d/mesh";
import {meshCachePathFor, readMeshCache} from "../rendering/3d/meshCache";

function response(status: number, body: string | Uint8Array = ""): FetchedFile {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return {
        ok: status >= 200 && status < 300,
        status,
        arrayBuffer: async () => bytes.slice().buffer,
    };
}

/** A fetch over a fixed set of URLs; anything else is a 404. Records every URL asked for. */
function stubFetch(served: Readonly<Record<string, string | Uint8Array>>, requested: string[] = []) {
    return async (url: string): Promise<FetchedFile> => {
        requested.push(url);
        const body = served[url];
        return body === undefined ? response(404) : response(200, body);
    };
}

async function rejection(promise: Promise<unknown>): Promise<Error | undefined> {
    try {
        await promise;
        return undefined;
    } catch (error) {
        return error as Error;
    }
}

const TRIANGLE_OBJ = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";

describe("PreloadedFileSource", () => {
    test("preloaded files read synchronously, keyed by normalized path", async () => {
        const files = new PreloadedFileSource({
            fetch: stubFetch({"models/a.txt": "hello", "models/b.bin": new Uint8Array([1, 2, 3])}),
        });
        await files.preload(["./models/a.txt", "models\\b.bin"]);
        expect(files.readText("models/a.txt")).toBe("hello");
        expect(files.readText("./models//a.txt")).toBe("hello");
        expect([...files.readBytes("models/b.bin")]).toEqual([1, 2, 3]);
        expect(files.exists("models/sub/../a.txt")).toBe(true);
        expect(files.paths().sort()).toEqual(["models/a.txt", "models/b.bin"]);
    });

    test("URLs are the base URL plus the encoded normalized path", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({baseUrl: "/assets/", fetch: stubFetch({}, requested)});
        await files.preload(["./demo/3d/my texture.png", "a\\b.obj"]);
        expect(requested.sort()).toEqual(["/assets/a/b.obj", "/assets/demo/3d/my%20texture.png"]);
    });

    test("a 404 is a missing file: exists is false and reads throw ENOENT", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({})});
        await files.preload(["gone.obj"]);
        expect(files.exists("gone.obj")).toBe(false);
        expect(() => files.readBytes("gone.obj")).toThrow("ENOENT");
        expect(() => files.readText("never-listed.mtl")).toThrow("ENOENT");
        let code: unknown;
        try {
            files.readBytes("gone.obj");
        } catch (error) {
            code = (error as {code?: unknown}).code;
        }
        expect(code).toBe("ENOENT");
    });

    test("any other HTTP failure rejects the preload", async () => {
        const files = new PreloadedFileSource({fetch: async () => response(500)});
        const error = await rejection(files.preload(["broken.obj"]));
        expect(error).toBeDefined();
        expect(error!.message.includes("HTTP 500")).toBe(true);
    });

    test("it is read-only, and stat needs a manifest modification time", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({"a.obj": "abc", "b.obj": "abcd"})});
        await files.preload(["a.obj", {path: "b.obj", mtimeMs: 1234}]);
        expect((files as {write?: unknown}).write).toBeUndefined();
        expect(() => files.stat("a.obj")).toThrow("modification time");
        expect(files.stat("b.obj")).toEqual({size: 4, mtimeMs: 1234});
    });

    test("loaders read through it, and a mesh cache is not trusted without an mtime", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({"models/tri.obj": TRIANGLE_OBJ, "models/tri.obj.meshcache": "junk"})});
        await files.preload(["models/tri.obj", meshCachePathFor("models/tri.obj")]);
        expect(readMeshCache("models/tri.obj", files)).toBeUndefined();
        const mesh = Mesh.fromFile("./models/tri.obj", {files});
        expect(mesh.triangleCount).toBe(1);
    });

    test("a stat-only entry is not fetched: it exists and stats from the manifest, reads throw", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch({"big.obj": "never fetched"}, requested)});
        await files.preload([{path: "big.obj", size: 86_000_000, mtimeMs: 42.5, statOnly: true}]);
        expect(requested).toEqual([]);
        expect(files.exists("big.obj")).toBe(true);
        expect(files.stat("./big.obj")).toEqual({size: 86_000_000, mtimeMs: 42.5});
        expect(() => files.readText("big.obj")).toThrow("stat-only");
        expect(() => files.readBytes("big.obj")).toThrow("stat-only");
        const error = await rejection(new PreloadedFileSource({fetch: stubFetch({})}).preload([{path: "x.obj", statOnly: true, size: 1}]));
        expect(error!.message.includes("mtimeMs")).toBe(true);
    });

    test("a listed size must match the bytes fetched", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({"a.mtl": "abc"})});
        expect(await rejection(files.preload([{path: "a.mtl", size: 3}]))).toBeUndefined();
        const error = await rejection(files.preload([{path: "a.mtl", size: 4}]));
        expect(error!.message.includes("rebuild")).toBe(true);
    });

    test("progress reports every entry once, with the listed bytes", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({"a": "abc", "b": "abcdefg"})});
        const reports: string[] = [];
        await files.preload([
            {path: "a", size: 3},
            {path: "b", size: 7},
            {path: "c.obj", size: 1000, mtimeMs: 1, statOnly: true},
        ], progress => reports.push(`${progress.loadedFiles}/${progress.totalFiles} ${progress.totalBytes}`));
        expect(reports.length).toBe(3);
        expect(reports[2]).toBe("3/3 10");
    });

    test("a mesh cache validates against a stat-only obj with the obj's real size and mtime", async () => {
        const source = new MemoryFileSource({"m/tri.obj": TRIANGLE_OBJ});
        const built = Mesh.fromFile("m/tri.obj", {files: source});
        const cachePath = meshCachePathFor("m/tri.obj");
        const objStat = source.stat("m/tri.obj");
        const files = new PreloadedFileSource({fetch: stubFetch({[cachePath]: source.readBytes(cachePath)})});
        await files.preload([
            {path: "m/tri.obj", size: objStat.size, mtimeMs: objStat.mtimeMs, statOnly: true},
            {path: cachePath, size: source.stat(cachePath).size},
        ]);
        expect(readMeshCache("m/tri.obj", files)).toBeDefined();
        expect(Mesh.fromFile("m/tri.obj", {files}).triangleCount).toBe(built.triangleCount);
    });
});
