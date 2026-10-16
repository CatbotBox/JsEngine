import {gzipSync} from "zlib";
import {describe, expect, test} from "../testing/harness";
import {PreloadedFileSource} from "./preloadedFileSource";
import type {PreloadProgress} from "./preloadedFileSource";
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

/** Real `Response`s whose bodies arrive in `chunkBytes` pieces, one per task. Records every URL asked for. */
function streamingFetch(served: Readonly<Record<string, string | Uint8Array>>, chunkBytes: number, requested: string[] = []) {
    return async (url: string): Promise<FetchedFile> => {
        requested.push(url);
        const body = served[url];
        if (body === undefined) return new Response("Not found", {status: 404});
        const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
        let offset = 0;
        return new Response(new ReadableStream<Uint8Array>({
            async pull(controller) {
                await new Promise(done => setTimeout(done, 0));
                if (offset >= bytes.length) {
                    controller.close();
                    return;
                }
                controller.enqueue(bytes.slice(offset, offset + chunkBytes));
                offset += chunkBytes;
            },
        }));
    };
}

/** `bytes` gzip-compressed and cut at `cuts` (offsets into the compressed bytes), served as `<path>.gz.partN`. */
function gzipParts(path: string, bytes: Uint8Array, cuts: readonly number[]): {served: Record<string, Uint8Array>, parts: number[]} {
    const compressed = new Uint8Array(gzipSync(bytes, {level: 9}));
    const bounds = [0, ...cuts, compressed.length];
    const served: Record<string, Uint8Array> = {};
    const parts: number[] = [];
    for (let part = 0; part + 1 < bounds.length; part++) {
        served[`${path}.gz.part${part}`] = compressed.slice(bounds[part], bounds[part + 1]);
        parts.push(bounds[part + 1] - bounds[part]);
    }
    return {served, parts};
}

/** Text that compresses well but not trivially. */
function sampleText(length: number): Uint8Array {
    const words = ["vertex", "normal", "face", "texture", "mesh", "cache", "light", "camera"];
    let text = "";
    for (let i = 0; text.length < length; i++) text += words[(i * 7 + (i >> 3)) % words.length] + (i % 13 === 0 ? "\n" : " ");
    return new TextEncoder().encode(text.slice(0, length));
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

    test("progress reports the start and every entry once, with the listed bytes", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({"a": "abc", "b": "abcdefg"})});
        const reports: string[] = [];
        await files.preload([
            {path: "a", size: 3},
            {path: "b", size: 7},
            {path: "c.obj", size: 1000, mtimeMs: 1, statOnly: true},
        ], progress => reports.push(`${progress.loadedFiles}/${progress.totalFiles} ${progress.loadedBytes}/${progress.totalBytes}`));
        expect(reports.length).toBe(4);
        expect(reports[0]).toBe("0/3 0/10");
        expect(reports[3]).toBe("3/3 10/10");
    });

    test("streamed bodies report bytes as they arrive; an entry without a size counts none", async () => {
        const body = new Uint8Array(10_000).map((_, i) => i % 251);
        const files = new PreloadedFileSource({fetch: streamingFetch({"big.bin": body, "free.txt": "no size"}, 1000)});
        const loaded: number[] = [];
        await files.preload([{path: "big.bin", size: body.length}, "free.txt"], progress => loaded.push(progress.loadedBytes));
        expect([...files.readBytes("big.bin")]).toEqual([...body]);
        expect(files.readText("free.txt")).toBe("no size");
        expect(loaded.length).toBeGreaterThan(10);
        expect(loaded.every((bytes, i) => i === 0 || bytes >= loaded[i - 1])).toBe(true);
        expect(loaded[loaded.length - 1]).toBe(body.length);
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

describe("PreloadedFileSource lazy entries", () => {
    test("a lazy entry is registered, not fetched: it exists and stats, reads throw until ensureLoaded", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch({"big.meshcache": "lots of bytes", "small.mtl": "kd"}, requested)});
        await files.preload([{path: "big.meshcache", size: 13, mtimeMs: 7, lazy: true}, "small.mtl"]);
        expect(requested).toEqual(["small.mtl"]);
        expect(files.exists("big.meshcache")).toBe(true);
        expect(files.isPending("./big.meshcache")).toBe(true);
        expect(files.isPending("small.mtl")).toBe(false);
        expect(files.stat("big.meshcache")).toEqual({size: 13, mtimeMs: 7});
        expect(() => files.readBytes("big.meshcache")).toThrow("ensureLoaded");

        await files.ensureLoaded(["big.meshcache"]);
        expect(requested).toEqual(["small.mtl", "big.meshcache"]);
        expect(files.isPending("big.meshcache")).toBe(false);
        expect(files.readText("big.meshcache")).toBe("lots of bytes");
        expect(files.stat("big.meshcache")).toEqual({size: 13, mtimeMs: 7});
    });

    test("ensureLoaded fetches only pending paths: loaded, stat-only, unknown and repeated paths fetch nothing", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch({"a": "a", "lazy": "zz"}, requested)});
        await files.preload(["a", {path: "lazy", size: 2, lazy: true}, {path: "s.obj", size: 9, mtimeMs: 1, statOnly: true}]);
        const reports: PreloadProgress[] = [];
        await files.ensureLoaded(["a", "s.obj", "never-listed", "lazy", "./lazy"], progress => reports.push(progress));
        expect(requested).toEqual(["a", "lazy"]);
        expect(reports[reports.length - 1]).toEqual({loadedFiles: 1, totalFiles: 1, loadedBytes: 2, totalBytes: 2});
        const quiet: PreloadProgress[] = [];
        await files.ensureLoaded(["lazy"], progress => quiet.push(progress));
        expect(requested).toEqual(["a", "lazy"]);
        expect(quiet).toEqual([]);
    });

    test("concurrent ensureLoaded calls share one fetch, and both see its progress", async () => {
        const body = sampleText(8000);
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: streamingFetch({"m.bin": body}, 1000, requested)});
        await files.preload([{path: "m.bin", size: body.length, lazy: true}]);
        const first: number[] = [];
        const second: number[] = [];
        await Promise.all([
            files.ensureLoaded(["m.bin"], progress => first.push(progress.loadedBytes)),
            files.ensureLoaded(["m.bin"], progress => second.push(progress.loadedBytes)),
        ]);
        expect(requested).toEqual(["m.bin"]);
        expect(first.length).toBeGreaterThan(5);
        expect(second.length).toBeGreaterThan(5);
        expect(first[first.length - 1]).toBe(body.length);
        expect(second[second.length - 1]).toBe(body.length);
        expect([...files.readBytes("m.bin")]).toEqual([...body]);
    });

    test("a failed lazy fetch rejects and stays pending, so the next call fetches it again", async () => {
        let attempts = 0;
        const files = new PreloadedFileSource({
            fetch: async () => ++attempts === 1 ? response(503) : response(200, "second time"),
        });
        await files.preload([{path: "flaky.bin", size: 11, lazy: true}]);
        const error = await rejection(files.ensureLoaded(["flaky.bin"]));
        expect(error!.message.includes("HTTP 503")).toBe(true);
        expect(files.isPending("flaky.bin")).toBe(true);
        await files.ensureLoaded(["flaky.bin"]);
        expect(attempts).toBe(2);
        expect(files.readText("flaky.bin")).toBe("second time");
    });

    test("a lazy entry needs a size; one the server does not have becomes absent", async () => {
        const error = await rejection(new PreloadedFileSource({fetch: stubFetch({})}).preload([{path: "x.bin", lazy: true}]));
        expect(error!.message.includes("size")).toBe(true);
        const files = new PreloadedFileSource({fetch: stubFetch({})});
        await files.preload([{path: "gone.bin", size: 5, lazy: true}]);
        await files.ensureLoaded(["gone.bin"]);
        expect(files.exists("gone.bin")).toBe(false);
        expect(files.isPending("gone.bin")).toBe(false);
        expect(() => files.readBytes("gone.bin")).toThrow("ENOENT");
    });

    test("preload progress leaves lazy entries out", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({"a": "abc"})});
        const reports: PreloadProgress[] = [];
        await files.preload([{path: "a", size: 3}, {path: "huge", size: 90_000_000, lazy: true}], progress => reports.push(progress));
        expect(reports[reports.length - 1]).toEqual({loadedFiles: 1, totalFiles: 1, loadedBytes: 3, totalBytes: 3});
    });

    test("a lazy, gzip-compressed mesh cache loads through ensureLoaded and then Mesh.fromFile", async () => {
        const source = new MemoryFileSource({"m/tri.obj": TRIANGLE_OBJ});
        const built = Mesh.fromFile("m/tri.obj", {files: source});
        const cachePath = meshCachePathFor("m/tri.obj");
        const cache = source.readBytes(cachePath);
        const objStat = source.stat("m/tri.obj");
        const {served, parts} = gzipParts(cachePath, cache, [5]);
        const files = new PreloadedFileSource({fetch: streamingFetch(served, 64)});
        await files.preload([
            {path: "m/tri.obj", size: objStat.size, mtimeMs: objStat.mtimeMs, statOnly: true},
            {path: cachePath, size: cache.length, mtimeMs: 1, lazy: true, gzipParts: parts},
        ]);
        expect(readMeshCache("m/tri.obj", files)).toBeUndefined();
        await files.ensureLoaded(["m/tri.obj", cachePath]);
        expect(readMeshCache("m/tri.obj", files)).toBeDefined();
        expect(Mesh.fromFile("m/tri.obj", {files}).triangleCount).toBe(built.triangleCount);
    });
});

describe("PreloadedFileSource gzip parts", () => {
    const original = sampleText(50_000);

    test("parts are fetched from <url>.gz.partN in order and decompressed, streamed or not", async () => {
        const {served, parts} = gzipParts("dir/my file.bin", original, [10, 400]);
        const encoded = Object.fromEntries(Object.entries(served).map(([path, bytes]) => [encodeURI(path), bytes]));
        for (const fetch of [streamingFetch(encoded, 97), stubFetch(encoded)]) {
            const requested: string[] = [];
            const files = new PreloadedFileSource({fetch: url => fetch(url).finally(() => requested.push(url))});
            await files.preload([{path: "dir/my file.bin", size: original.length, gzipParts: parts}]);
            expect(requested).toEqual(["dir/my%20file.bin.gz.part0", "dir/my%20file.bin.gz.part1", "dir/my%20file.bin.gz.part2"]);
            expect(files.readBytes("dir/my file.bin").length).toBe(original.length);
            expect([...files.readBytes("dir/my file.bin")]).toEqual([...original]);
        }
    });

    test("progress counts the compressed bytes of every part", async () => {
        const {served, parts} = gzipParts("a.bin", original, [100]);
        const compressedBytes = parts[0] + parts[1];
        const files = new PreloadedFileSource({fetch: streamingFetch(served, 50)});
        await files.preload([{path: "a.bin", size: original.length, lazy: true, gzipParts: parts}]);
        const reports: PreloadProgress[] = [];
        await files.ensureLoaded(["a.bin"], progress => reports.push(progress));
        expect(reports[0]).toEqual({loadedFiles: 0, totalFiles: 1, loadedBytes: 0, totalBytes: compressedBytes});
        expect(reports.length).toBeGreaterThan(3);
        expect(reports[reports.length - 1]).toEqual({loadedFiles: 1, totalFiles: 1, loadedBytes: compressedBytes, totalBytes: compressedBytes});
    });

    test("a part of the wrong size, or a decompressed size that differs, fails as a stale build", async () => {
        const {served, parts} = gzipParts("a.bin", original, [100]);
        const wrongPart = new PreloadedFileSource({fetch: stubFetch(served)});
        const partError = await rejection(wrongPart.preload([{path: "a.bin", size: original.length, gzipParts: [parts[0] + 1, parts[1] - 1]}]));
        expect(partError!.message.includes("part 0")).toBe(true);
        expect(partError!.message.includes("rebuild")).toBe(true);
        for (const size of [original.length - 1, original.length + 1]) {
            const files = new PreloadedFileSource({fetch: streamingFetch(served, 500)});
            const error = await rejection(files.preload([{path: "a.bin", size, gzipParts: parts}]));
            expect(error!.message.includes("rebuild")).toBe(true);
            expect(files.exists("a.bin")).toBe(false);
        }
    });

    test("corrupt compressed data rejects", async () => {
        const {served, parts} = gzipParts("a.bin", original, []);
        const corrupt = served["a.bin.gz.part0"].slice();
        for (let i = 20; i < corrupt.length - 8; i += 3) corrupt[i] ^= 0x5a;
        const files = new PreloadedFileSource({fetch: stubFetch({"a.bin.gz.part0": corrupt})});
        const error = await rejection(files.preload([{path: "a.bin", size: original.length, gzipParts: parts}]));
        expect(error).toBeDefined();
        expect(files.exists("a.bin")).toBe(false);
    });

    test("a missing first part is an absent file; a missing later part is an error", async () => {
        const absent = new PreloadedFileSource({fetch: stubFetch({})});
        await absent.preload([{path: "a.bin", size: 10, gzipParts: [5, 5]}]);
        expect(absent.exists("a.bin")).toBe(false);
        const {served, parts} = gzipParts("a.bin", original, [100]);
        const broken = new PreloadedFileSource({fetch: stubFetch({"a.bin.gz.part0": served["a.bin.gz.part0"]})});
        const error = await rejection(broken.preload([{path: "a.bin", size: original.length, gzipParts: parts}]));
        expect(error!.message.includes("part 1")).toBe(true);
        expect(error!.message.includes("HTTP 404")).toBe(true);
    });
});
