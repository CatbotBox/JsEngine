import {describe, expect, test} from "../../engine/testing/harness";
import {PreloadedFileSource} from "./preloadedFileSource";
import type {FetchedFile, PreloadProgress} from "./preloadedFileSource";
import {projectAssetManifestPath, WebProjectAssetFiles} from "./webProjectAssets";
import type {ProjectAssetManifest} from "./webProjectAssets";

const DIRECTORY = "games/demo";
const UP_FRONT_TEXT = "up front";
const LAZY_TEXT = "fetched later";
const SECOND_LAZY_TEXT = "fetched after that";
const MTIME_MS = 1;

function response(status: number, body = ""): FetchedFile {
    const bytes = new TextEncoder().encode(body);
    return {ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes.slice().buffer};
}

function stubFetch(served: Readonly<Record<string, string>>, requested: string[]) {
    return async (url: string): Promise<FetchedFile> => {
        requested.push(url);
        const body = served[url];
        return body === undefined ? response(404) : response(200, body);
    };
}

function sitePath(path: string): string {
    return `${DIRECTORY}/${path}`;
}

const MANIFEST: ProjectAssetManifest = {
    prefabs: [],
    files: [
        {path: sitePath("model.cache"), size: UP_FRONT_TEXT.length, mtimeMs: MTIME_MS},
        {path: sitePath("model.source"), size: 1000, mtimeMs: MTIME_MS, statOnly: true},
        {path: sitePath("big.cache"), size: LAZY_TEXT.length, mtimeMs: MTIME_MS, lazy: true},
        {path: sitePath("big.texture"), size: SECOND_LAZY_TEXT.length, mtimeMs: MTIME_MS, lazy: true},
    ],
};

function servedSite(manifest: ProjectAssetManifest = MANIFEST): Record<string, string> {
    return {
        [projectAssetManifestPath(DIRECTORY)]: JSON.stringify(manifest),
        [sitePath("model.cache")]: UP_FRONT_TEXT,
        [sitePath("big.cache")]: LAZY_TEXT,
        [sitePath("big.texture")]: SECOND_LAZY_TEXT,
    };
}

describe("PreloadedFileSource.loadFetchingAsNeeded", () => {
    test("fetches the first lazy file each pass reads until the load succeeds", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch({"a.txt": "A", "b.txt": "B"}, requested)});
        await files.preload([{path: "a.txt", size: 1, lazy: true}, {path: "b.txt", size: 1, lazy: true}]);
        const progress: PreloadProgress[] = [];
        const text = await files.loadFetchingAsNeeded(() => files.readText("a.txt") + files.readText("b.txt"), each => progress.push(each));
        expect(text).toBe("AB");
        expect(requested).toEqual(["a.txt", "b.txt"]);
        expect(progress[progress.length - 1]).toEqual({loadedFiles: 2, totalFiles: 2, loadedBytes: 2, totalBytes: 2});
    });

    test("a failure that no pending file explains is rethrown without fetching", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch({}, requested)});
        let failure: unknown;
        await files.loadFetchingAsNeeded(() => files.readText("missing.txt")).catch(error => failure = error);
        expect((failure as Error).message).toBe("ENOENT: no such file or directory, not preloaded: missing.txt");
        expect(requested).toEqual([]);
    });
});

describe("WebProjectAssetFiles", () => {
    test("fetches the files listed up front, registers the others, and lists the fetchable ones by project path", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch(servedSite(), requested)});
        const assets = await WebProjectAssetFiles.open(files, DIRECTORY);
        expect(requested).toEqual([projectAssetManifestPath(DIRECTORY), sitePath("model.cache")]);
        expect(files.readText(sitePath("model.cache"))).toBe(UP_FRONT_TEXT);
        expect(files.isPending(sitePath("big.cache"))).toBe(true);
        expect(files.stat(sitePath("model.source"))).toEqual({size: 1000, mtimeMs: MTIME_MS});
        expect(assets.list().map(file => file.path)).toEqual(["model.cache", "big.cache", "big.texture"]);
    });

    test("reports every fetch, stat-only listings included, as one growing status line until reporting stops, and waits for fetches in flight", async () => {
        const statuses: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch(servedSite(), [])});
        const assets = await WebProjectAssetFiles.open(files, DIRECTORY, text => statuses.push(text));
        const load = assets.loadFetchingAsNeeded(() => files.readText(sitePath("big.cache")) + files.readText(sitePath("big.texture")));
        await assets.whenIdle();
        expect(await load).toBe(LAZY_TEXT + SECOND_LAZY_TEXT);
        const totalBytes = UP_FRONT_TEXT.length + LAZY_TEXT.length + SECOND_LAZY_TEXT.length;
        expect(statuses[statuses.length - 1]).toBe(`Loading assets: 4/4 files, ${(totalBytes / (1024 * 1024)).toFixed(1)}/${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
        assets.stopReporting();
        const shown = statuses.length;
        await assets.ensureLoaded(["model.cache"]);
        expect(statuses.length).toBe(shown);
    });

    test("a project without asset files shows no status", async () => {
        const statuses: string[] = [];
        const files = new PreloadedFileSource({fetch: stubFetch(servedSite({prefabs: [], files: []}), [])});
        await WebProjectAssetFiles.open(files, DIRECTORY, text => statuses.push(text));
        expect(statuses).toEqual([]);
    });

    test("a site built without the asset list fails, naming the file and the build command", async () => {
        const files = new PreloadedFileSource({fetch: stubFetch({}, [])});
        let failure: unknown;
        await WebProjectAssetFiles.open(files, DIRECTORY).catch(error => failure = error);
        expect((failure as Error).message)
            .toBe(`${projectAssetManifestPath(DIRECTORY)} was not found: build the site with jsengine build --target web, which lists the project's asset files there`);
    });
});
