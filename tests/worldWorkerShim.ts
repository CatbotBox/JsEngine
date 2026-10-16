/**
 * Preloaded into the world workers tests/verifyWorldWorker.ts spawns. It supplies what a browser
 * gives a page's worker and bun's does not: a base for relative fetches (served from the
 * repository, the 3D manifest built as scripts/buildWeb.ts would write it) and, when the test
 * asks, a cross-origin isolated context. bun already has SharedArrayBuffer and nested Web
 * Workers, so only the `crossOriginIsolated` flag is missing.
 */
import {readFileSync} from "fs";
import {join, resolve} from "path";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest} from "../demo/3d/assets";

const ROOT = resolve(__dirname, "..");
const MANIFEST_URL = "3d-manifest.json";

let manifest: Demo3dManifest | undefined;

async function fetchFromRepository(url: string): Promise<Response> {
    if (url === MANIFEST_URL) return Response.json(manifest ??= buildDemo3dManifest(ROOT));
    try {
        return new Response(new Uint8Array(readFileSync(join(ROOT, decodeURI(url)))));
    } catch {
        return new Response("Not found", {status: 404});
    }
}

(globalThis as {fetch: unknown}).fetch = fetchFromRepository;
if (process.env.JSENGINE_VERIFY_ISOLATED === "1") {
    (globalThis as {crossOriginIsolated?: boolean}).crossOriginIsolated = true;
}
