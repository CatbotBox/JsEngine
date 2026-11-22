import {readFileSync} from "fs";
import {join} from "path";
import {PROJECT_ASSET_MANIFEST_FILE} from "../src/hosts/web/webProjectAssets";
import {nodePlatform} from "../src/hosts/terminal";
import {buildProjectAssetManifest, projectAssetRegistry} from "../src/toolchain/build/projectAssets";
import {WEB_PROJECT_DIRECTORY} from "../src/toolchain/projectLayout";

const SERVING_BUILT_SITE = process.env.JSENGINE_VERIFY_DIST !== undefined;
const PROJECT_FILES = process.env.JSENGINE_VERIFY_FILES!;
const CHUNK_BYTES = 512 * 1024;
const CHUNK_DELAY_MS = 5;

let assetManifest: Uint8Array | undefined;

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

async function builtAssetManifest(): Promise<Uint8Array> {
    assetManifest ??= new TextEncoder().encode(JSON.stringify(buildProjectAssetManifest(PROJECT_FILES, WEB_PROJECT_DIRECTORY, nodePlatform(), await projectAssetRegistry(PROJECT_FILES))));
    return assetManifest;
}

async function served(url: string): Promise<Uint8Array | undefined> {
    const path = decodeURI(url);
    if (!SERVING_BUILT_SITE && path === PROJECT_ASSET_MANIFEST_FILE) return await builtAssetManifest();
    try {
        return new Uint8Array(readFileSync(join(PROJECT_FILES, path)));
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
