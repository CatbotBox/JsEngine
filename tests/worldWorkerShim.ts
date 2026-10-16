/**
 * Preloaded into the world workers tests/verifyWorldWorker.ts spawns. It supplies what a browser
 * gives a page's worker and bun's does not: a base for relative fetches and, when the test asks,
 * a cross-origin isolated context. bun already has SharedArrayBuffer and nested Web Workers, so
 * only the `crossOriginIsolated` flag is missing.
 *
 * Fetches are served from the repository (the 3D manifest built as scripts/buildWeb.ts would
 * write it), or from a built site when JSENGINE_VERIFY_DIST names one. Bodies stream in small
 * chunks at a network-like pace, so a download is still in progress for several frames, and each
 * fetched URL is posted to the page as `{type: "verify-fetch", url}`.
 */
import {readFileSync} from "fs";
import {join, resolve} from "path";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest} from "../demo/3d/assets";

const ROOT = resolve(__dirname, "..");
const DIST = process.env.JSENGINE_VERIFY_DIST;
const MANIFEST_URL = "3d-manifest.json";
const CHUNK_BYTES = 512 * 1024;
const CHUNK_DELAY_MS = 5;

let manifest: Demo3dManifest | undefined;

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

function served(url: string): Uint8Array | undefined {
    if (DIST === undefined && url === MANIFEST_URL) {
        return new TextEncoder().encode(JSON.stringify(manifest ??= buildDemo3dManifest(ROOT)));
    }
    try {
        return new Uint8Array(readFileSync(join(DIST ?? ROOT, decodeURI(url))));
    } catch {
        return undefined;
    }
}

async function fetchServed(url: string): Promise<Response> {
    (globalThis as {postMessage?: (message: unknown) => void}).postMessage?.({type: "verify-fetch", url});
    const bytes = served(url);
    if (bytes === undefined) return new Response("Not found", {status: 404});
    return new Response(paced(bytes));
}

(globalThis as {fetch: unknown}).fetch = fetchServed;
if (process.env.JSENGINE_VERIFY_ISOLATED === "1") {
    (globalThis as {crossOriginIsolated?: boolean}).crossOriginIsolated = true;
}
