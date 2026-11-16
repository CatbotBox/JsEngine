import {describe, expect, test} from "../../engine/testing/harness";
import {PreloadedFileSource} from "./preloadedFileSource";
import type {FetchedFile} from "./preloadedFileSource";
import {projectFilePreload} from "./projectFilePreload";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const MANIFEST_URL = "demo/swarm/jsengine.project.json";
const INPUT_URL = "demo/swarm/assets/input.asset.json";
const MANIFEST_TEXT = "{\"name\": \"Swarm\"}";
const INPUT_TEXT = "{\"format\": \"jsengine-asset\"}";

function servedFetch(served: Readonly<Record<string, string>>, requested: string[]) {
    return async (url: string): Promise<FetchedFile> => {
        requested.push(url);
        const body = served[url];
        const bytes = new TextEncoder().encode(body ?? "");
        return {ok: body !== undefined, status: body === undefined ? HTTP_NOT_FOUND : HTTP_OK, arrayBuffer: async () => bytes.slice().buffer};
    };
}

describe("projectFilePreload", () => {
    test("fetches project-relative paths below the project folder once each", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: servedFetch({[MANIFEST_URL]: MANIFEST_TEXT, [INPUT_URL]: INPUT_TEXT}, requested)});
        const preload = projectFilePreload(files, "demo/swarm");
        await preload(["jsengine.project.json"]);
        await preload(["jsengine.project.json", "assets/input.asset.json"]);
        expect(requested).toEqual([MANIFEST_URL, INPUT_URL]);
        expect([files.readText(MANIFEST_URL), files.readText(INPUT_URL)]).toEqual([MANIFEST_TEXT, INPUT_TEXT]);
    });

    test("a file the site does not serve stays missing, so the reader reports the path", async () => {
        const files = new PreloadedFileSource({fetch: servedFetch({}, [])});
        await projectFilePreload(files, "demo/swarm")(["assets/input.asset.json"]);
        expect(files.exists(INPUT_URL)).toBe(false);
    });

    test("a lazily listed file is fetched when the project reads it", async () => {
        const requested: string[] = [];
        const files = new PreloadedFileSource({fetch: servedFetch({[INPUT_URL]: INPUT_TEXT}, requested)});
        await files.preload([{path: INPUT_URL, size: INPUT_TEXT.length, lazy: true}]);
        await projectFilePreload(files, "demo/swarm")(["assets/input.asset.json"]);
        expect([requested, files.readText(INPUT_URL)]).toEqual([[INPUT_URL], INPUT_TEXT]);
    });
});
