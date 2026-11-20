import {readFileSync} from "fs";
import {join, resolve} from "path";
import {PROJECT_ASSET_MANIFEST_FILE} from "../src/hosts/web/webProjectAssets";
import {nodePlatform} from "../src/hosts/terminal";
import {buildProjectAssetManifest, projectAssetRegistry} from "../src/toolchain/build/projectAssets";

const ROOT = resolve(__dirname, "..");
const DIST = process.env.JSENGINE_VERIFY_DIST;
const ASSET_MANIFEST_SUFFIX = `/${PROJECT_ASSET_MANIFEST_FILE}`;
const CHUNK_BYTES = 512 * 1024;
const CHUNK_DELAY_MS = 5;

const assetManifests = new Map<string, Uint8Array>();

function paced(bytes: Uint8Array): ReadableStream<Uint8Array> {
    let offset = 0;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (offset >= bytes.length) {
                controller.close();
                return;
            }
            await new Promise(done => setTimeout(done, CHUNK_DELAY_MS));
            controller.enqueue(bytes.slice(offset, offset + CHUNK_BYTES));
            offset += CHUNK_BYTES;
        },
    });
}

async function assetManifest(url: string): Promise<Uint8Array> {
    const directory = decodeURI(url).slice(0, -ASSET_MANIFEST_SUFFIX.length);
    const built = assetManifests.get(directory)
        ?? new TextEncoder().encode(JSON.stringify(buildProjectAssetManifest(ROOT, directory, nodePlatform(), await projectAssetRegistry(join(ROOT, directory)))));
    assetManifests.set(directory, built);
    return built;
}

async function served(url: string): Promise<Uint8Array | undefined> {
    if (DIST === undefined && url.endsWith(ASSET_MANIFEST_SUFFIX)) return await assetManifest(url);
    try {
        return new Uint8Array(readFileSync(join(DIST ?? ROOT, decodeURI(url))));
    } catch {
        return undefined;
    }
}

async function fetchServed(url: string): Promise<Response> {
    (globalThis as {postMessage?: (message: unknown) => void}).postMessage?.({type: "verify-fetch", url});
    const bytes = await served(url);
    if (bytes === undefined) return new Response("Not found", {status: 404});
    return new Response(paced(bytes));
}

(globalThis as {fetch: unknown}).fetch = fetchServed;
if (process.env.JSENGINE_VERIFY_ISOLATED === "1") {
    (globalThis as {crossOriginIsolated?: boolean}).crossOriginIsolated = true;
}
