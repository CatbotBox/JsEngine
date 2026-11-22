import {describe, expect, test} from "../../engine/testing/harness";
import {BundleStackMapper, REMEMBERED_BUNDLE_LIMIT} from "./stackMapper";

const PAGE_URL = "http://localhost:4000/editor.html?project=demo";
const FIRST_WORKER = "api/projects/demo/editor.worker.js?v=1";
const SECOND_WORKER = "api/projects/demo/editor.worker.js?v=2";
const FIRST_WORKER_URL = "http://localhost:4000/api/projects/demo/editor.worker.js?v=1";
const SECOND_WORKER_URL = "http://localhost:4000/api/projects/demo/editor.worker.js?v=2";
const BLOB_WORKER_URL = "blob:http://localhost:4000/0b5e5c1e-1111-2222-3333-444455556666";

function bundleText(sources: readonly string[]): string {
    const map = {version: 3, sources, names: [], mappings: "AAAA;ACCA"};
    return `run();\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}\n`;
}

class FakeBundles {
    public readonly fetched: string[] = [];

    public constructor(private readonly texts: ReadonlyMap<string, string>) {
    }

    public readonly fetchText = (url: string): Promise<string | undefined> => {
        this.fetched.push(url);
        return Promise.resolve(this.texts.get(url));
    };
}

function frame(url: string, line: number): string {
    return `    at tick (${url}:${line}:1)`;
}

describe("bundle stack mapper", () => {
    test("each bundle is fetched once when added, resolved against the page URL", async () => {
        const bundles = new FakeBundles(new Map([[FIRST_WORKER_URL, bundleText(["src/a.ts", "src/b.ts"])]]));
        const mapper = new BundleStackMapper(PAGE_URL, bundles.fetchText);
        mapper.addBundle(FIRST_WORKER);
        mapper.addBundle(FIRST_WORKER);
        expect(bundles.fetched).toEqual([FIRST_WORKER_URL]);
        const lines = await mapper.mapStack([frame(FIRST_WORKER_URL, 2), frame(FIRST_WORKER_URL, 1)].join("\n"));
        expect(lines.map(line => line.text)).toEqual(["    at tick (src/b.ts:2:1)", "    at tick (src/a.ts:1:1)"]);
        expect(lines.map(line => line.bundleFrame)).toEqual([frame(FIRST_WORKER_URL, 2), frame(FIRST_WORKER_URL, 1)]);
        expect(bundles.fetched).toEqual([FIRST_WORKER_URL]);
    });

    test("stacks from earlier bundles keep mapping with their own map after a reload", async () => {
        const bundles = new FakeBundles(new Map([
            [FIRST_WORKER_URL, bundleText(["src/old.ts", "src/old.ts"])],
            [SECOND_WORKER_URL, bundleText(["src/new.ts", "src/new.ts"])],
        ]));
        const mapper = new BundleStackMapper(PAGE_URL, bundles.fetchText);
        mapper.addBundle(FIRST_WORKER);
        mapper.addBundle(SECOND_WORKER);
        const lines = await mapper.mapStack([frame(FIRST_WORKER_URL, 1), frame(SECOND_WORKER_URL, 1)].join("\n"));
        expect(lines.map(line => line.text)).toEqual(["    at tick (src/old.ts:1:1)", "    at tick (src/new.ts:1:1)"]);
    });

    test("blob worker URLs map like served ones", async () => {
        const bundles = new FakeBundles(new Map([[BLOB_WORKER_URL, bundleText(["src/a.ts"])]]));
        const mapper = new BundleStackMapper(PAGE_URL, bundles.fetchText);
        mapper.addBundle(BLOB_WORKER_URL);
        const lines = await mapper.mapStack(frame(BLOB_WORKER_URL, 1));
        expect(lines.map(line => line.text)).toEqual(["    at tick (src/a.ts:1:1)"]);
    });

    test("unknown bundles, failed fetches and bundles without a map leave frames as they are", async () => {
        const bundles = new FakeBundles(new Map([[SECOND_WORKER_URL, "run();\n"]]));
        const mapper = new BundleStackMapper(PAGE_URL, bundles.fetchText);
        mapper.addBundle(FIRST_WORKER);
        mapper.addBundle(SECOND_WORKER);
        const stack = [frame(FIRST_WORKER_URL, 1), frame(SECOND_WORKER_URL, 1), frame("http://localhost:4000/other.js", 1)].join("\n");
        const lines = await mapper.mapStack(stack);
        expect(lines.map(line => line.text).join("\n")).toBe(stack);
        expect(lines.every(line => line.bundleFrame === undefined)).toBe(true);
    });

    test("only the most recent bundles are remembered", async () => {
        const texts = new Map<string, string>();
        const workers: string[] = [];
        for (let version = 0; version <= REMEMBERED_BUNDLE_LIMIT; version++) {
            const url = `http://localhost:4000/editor.worker.js?v=${version}`;
            workers.push(url);
            texts.set(url, bundleText([`src/v${version}.ts`]));
        }
        const mapper = new BundleStackMapper(PAGE_URL, new FakeBundles(texts).fetchText);
        for (const worker of workers) mapper.addBundle(worker);
        const lines = await mapper.mapStack(workers.map(worker => frame(worker, 1)).join("\n"));
        expect(lines[0].bundleFrame).toBeUndefined();
        expect(lines.slice(1).map(line => line.text)).toEqual(workers.slice(1).map((_, index) => `    at tick (src/v${index + 1}.ts:1:1)`));
    });
});
