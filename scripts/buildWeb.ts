import {copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, extname, join, relative, resolve} from "path";
import {gzipSync} from "zlib";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest, ManifestFile} from "../demo/3d/assets";
import {nodePlatform} from "../src/hosts/terminal";
import type {RenderBackend} from "../src/hosts/web/worldWorkerProtocol";
import {EDITOR_MESSAGE_TYPE} from "../src/editor/editorProtocol";

const ROOT = resolve(__dirname, "..");
const WEB = join(ROOT, "src", "hosts", "web");
const PROD = process.argv.includes("--prod");
const WITH_EDITOR = !PROD || process.argv.includes("--with-editor");
const OUT = join(ROOT, "dist", PROD ? "web-prod" : "web");
const DEMO = join(ROOT, "demo");
const EDITOR_LAUNCH = join(ROOT, "src", "editor", "launch");

type BundleRole = "game" | "editor";

interface EntryPoint {
    readonly source: string;
    readonly output: string;
    readonly backend?: RenderBackend;
    readonly role?: BundleRole;
}

const ENTRY_POINTS: readonly EntryPoint[] = [
    {source: join(WEB, "2d.ts"), output: "2d"},
    {source: join(WEB, "2d-cells.ts"), output: "2d-cells", backend: "cells"},
    {source: join(WEB, "2d-pixels.ts"), output: "2d-pixels", backend: "pixels"},
    {source: join(DEMO, "2d", "launch", "web.worker.ts"), output: "world2d.worker", backend: "cells"},
    {source: join(DEMO, "2d", "launch", "pixelWeb.worker.ts"), output: "world2d-pixels.worker", backend: "pixels"},
    {source: join(WEB, "3d.ts"), output: "3d"},
    {source: join(WEB, "3d-cells.ts"), output: "3d-cells", backend: "cells"},
    {source: join(WEB, "3d-pixels.ts"), output: "3d-pixels", backend: "pixels"},
    {source: join(DEMO, "3d", "launch", "web.worker.ts"), output: "world3d.worker", backend: "cells"},
    {source: join(DEMO, "3d", "launch", "pixelWeb.worker.ts"), output: "world3d-pixels.worker", backend: "pixels"},
    {source: join(WEB, "swarm.ts"), output: "swarm"},
    {source: join(WEB, "swarm-cells.ts"), output: "swarm-cells", backend: "cells"},
    {source: join(WEB, "swarm-pixels.ts"), output: "swarm-pixels", backend: "pixels"},
    {source: join(DEMO, "swarm", "launch", "web.worker.ts"), output: "worldswarm.worker", backend: "cells"},
    {source: join(DEMO, "swarm", "launch", "pixelWeb.worker.ts"), output: "worldswarm-pixels.worker", backend: "pixels"},
    {source: join(DEMO, "2d", "launch", "editor.worker.ts"), output: "editor2d.worker", backend: "pixels", role: "editor"},
    {source: join(DEMO, "3d", "launch", "editor.worker.ts"), output: "editor3d.worker", backend: "pixels", role: "editor"},
    {source: join(EDITOR_LAUNCH, "editor.ts"), output: "editor", backend: "pixels", role: "editor"},
];
const DEFAULT_BUNDLE_ROLE: BundleRole = "game";
const OUTPUT_EXTENSION_PLACEHOLDER = "[ext]";
const BUNDLE_EXTENSION = ".js";
const RENDER_BACKENDS: readonly RenderBackend[] = ["cells", "pixels"];
const BOOTSTRAP_BUNDLE = "bootstrap";
const PRESENTER_MISSING_MESSAGES: Readonly<Record<RenderBackend, string>> = {
    cells: "This world has no CellPresenterResource",
    pixels: "This world has no PixelPresenterResource",
};
const STATIC_FILES: readonly [from: string, to: string][] =
    ["index.html", "2d.html", "3d.html", "swarm.html", "demo.css", "coi-serviceworker.js", "_headers"].map((name): [string, string] => [join(WEB, name), name]);
const EDITOR_STATIC_FILES: readonly [from: string, to: string][] =
    ["editor.html", "editor.css"].map((name): [string, string] => [join(EDITOR_LAUNCH, name), name]);
const COPIED_STATIC_FILES = WITH_EDITOR ? [...STATIC_FILES, ...EDITOR_STATIC_FILES] : STATIC_FILES;
const GITHUB_PAGES_NO_JEKYLL = ".nojekyll";

const MANIFEST_3D = "3d-manifest.json";
const KB = 1024;
const MB = 1024 * 1024;
const DEV_MANIFEST_INDENT_SPACES = 1;

interface FirstLoad {
    readonly page: string;
    readonly files: readonly string[];
    readonly fetchesDemo3dAssets: boolean;
}

const FIRST_LOADS: readonly FirstLoad[] = [
    {page: "index.html", files: ["index.html", "coi-serviceworker.js"], fetchesDemo3dAssets: false},
    {page: "2d.html", files: ["2d.html", "demo.css", "2d.js", "2d-cells.js", "world2d.worker.js"], fetchesDemo3dAssets: false},
    {page: "2d.html?backend=pixels", files: ["2d.html", "demo.css", "2d.js", "2d-pixels.js", "world2d-pixels.worker.js"], fetchesDemo3dAssets: false},
    {page: "3d.html", files: ["3d.html", "coi-serviceworker.js", "demo.css", "3d.js", "3d-cells.js", "world3d.worker.js", MANIFEST_3D], fetchesDemo3dAssets: true},
    {page: "3d.html?backend=pixels", files: ["3d.html", "coi-serviceworker.js", "demo.css", "3d.js", "3d-pixels.js", "world3d-pixels.worker.js", MANIFEST_3D], fetchesDemo3dAssets: true},
    {page: "swarm.html", files: ["swarm.html", "demo.css", "swarm.js", "swarm-cells.js", "worldswarm.worker.js"], fetchesDemo3dAssets: false},
    {page: "swarm.html?backend=pixels", files: ["swarm.html", "demo.css", "swarm.js", "swarm-pixels.js", "worldswarm-pixels.worker.js"], fetchesDemo3dAssets: false},
];

const MIN_GZIP_SAVING_FRACTION = 0.1;
const MIN_GZIP_BYTES = 64 * KB;
const PRECOMPRESSED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".gz", ".zip"]);
const GZIP_PART_BYTES = 20 * MB;
const GZIP_LEVEL_MAX = 9;
const GZIP_LEVEL_HOST_TRANSIT = 6;

const FORBIDDEN: readonly [label: string, pattern: RegExp][] = [
    ["node module require", /require\(\s*["'](node:)?(fs|path|os|zlib|worker_threads|util)["']\s*\)/],
    ["node: specifier", /["']node:[\w/]+["']/],
    ["process stdio", /process\.(stdout|stdin)/],
    ["fileLogger", /crash-logs/],
];

function outputFiles(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? outputFiles(path) : [path];
    });
}

function siteRelative(path: string): string {
    return relative(OUT, path).replace(/\\/g, "/");
}

function leaks(path: string): string[] {
    const text = readFileSync(path, "utf8");
    return FORBIDDEN.flatMap(([label, pattern]) => {
        const match = pattern.exec(text);
        if (match === null) return [];
        const line = text.slice(0, match.index).split("\n").length;
        return [`${path}:${line}: ${label}: ${match[0]}`];
    });
}

function roleOf(entry: EntryPoint): BundleRole {
    return entry.role ?? DEFAULT_BUNDLE_ROLE;
}

const BUILT_ENTRY_POINTS = ENTRY_POINTS.filter(entry => roleOf(entry) !== "editor" || WITH_EDITOR);

function bundlePath(entry: EntryPoint): string {
    return join(OUT, entry.output + BUNDLE_EXTENSION);
}

function otherBackendsIn(entry: EntryPoint, text: string): string[] {
    return RENDER_BACKENDS.filter(backend => backend !== entry.backend && text.includes(PRESENTER_MISSING_MESSAGES[backend]))
        .map(backend => `${siteRelative(bundlePath(entry))}: the ${backend} presenter is in a ${entry.backend ?? BOOTSTRAP_BUNDLE} bundle ("${PRESENTER_MISSING_MESSAGES[backend]}")`);
}

function backendMarkersNotFound(textByEntry: ReadonlyMap<EntryPoint, string>): string[] {
    return RENDER_BACKENDS
        .filter(backend => ![...textByEntry].some(([entry, text]) => entry.backend === backend && text.includes(PRESENTER_MISSING_MESSAGES[backend])))
        .map(backend => `no ${backend} bundle contains "${PRESENTER_MISSING_MESSAGES[backend]}": the guard no longer matches the source message`);
}

function bundleTexts(): Map<EntryPoint, string> {
    return new Map(BUILT_ENTRY_POINTS.map(entry => [entry, readFileSync(bundlePath(entry), "utf8")]));
}

function backendLeaks(textByEntry: ReadonlyMap<EntryPoint, string>): string[] {
    return [
        ...[...textByEntry].flatMap(([entry, text]) => otherBackendsIn(entry, text)),
        ...backendMarkersNotFound(textByEntry),
    ];
}

function editorProtocolMisplaced(textByEntry: ReadonlyMap<EntryPoint, string>): string[] {
    return [...textByEntry].flatMap(([entry, text]) => {
        const carriesEditor = text.includes(EDITOR_MESSAGE_TYPE);
        const bundle = siteRelative(bundlePath(entry));
        if (roleOf(entry) === "editor") return carriesEditor ? [] : [`${bundle}: the editor bundle does not contain "${EDITOR_MESSAGE_TYPE}": the guard no longer matches the protocol`];
        return carriesEditor ? [`${bundle}: a game bundle contains "${EDITOR_MESSAGE_TYPE}", so it reaches the editor`] : [];
    });
}

function gzipPartSizesIfWorthIt(bytes: Uint8Array, target: string): number[] | undefined {
    const compressed = gzipSync(bytes, {level: GZIP_LEVEL_MAX});
    if (compressed.length > bytes.length * (1 - MIN_GZIP_SAVING_FRACTION)) return undefined;
    const parts: number[] = [];
    for (let offset = 0; offset < compressed.length; offset += GZIP_PART_BYTES) {
        const part = compressed.subarray(offset, offset + GZIP_PART_BYTES);
        writeFileSync(`${target}.gz.part${parts.length}`, part);
        parts.push(part.length);
    }
    return parts;
}

function shouldGzip(file: ManifestFile): boolean {
    return PROD && file.size >= MIN_GZIP_BYTES && !PRECOMPRESSED_EXTENSIONS.has(extname(file.path).toLowerCase());
}

function transferBytes(file: ManifestFile): number {
    if (file.statOnly === true) return 0;
    return file.gzipParts?.reduce((sum, part) => sum + part, 0) ?? file.size;
}

function writeDemo3dAssets(): Demo3dManifest {
    const built = buildDemo3dManifest(ROOT, nodePlatform());
    const files = built.files.map((file): ManifestFile => {
        if (file.statOnly === true) return file;
        const target = join(OUT, file.path);
        mkdirSync(dirname(target), {recursive: true});
        if (shouldGzip(file)) {
            const gzipParts = gzipPartSizesIfWorthIt(readFileSync(join(ROOT, file.path)), target);
            if (gzipParts !== undefined) return {...file, gzipParts};
        }
        copyFileSync(join(ROOT, file.path), target);
        return file;
    });
    const manifest: Demo3dManifest = {models: built.models, files};
    writeFileSync(join(OUT, MANIFEST_3D), JSON.stringify(manifest, null, PROD ? undefined : DEV_MANIFEST_INDENT_SPACES));
    return manifest;
}

function sizeOf(path: string): number {
    return statSync(join(OUT, path)).size;
}

function transitGzippedSizeOf(path: string): number {
    if (!/\.(html|css|js|json)$/.test(path)) return sizeOf(path);
    return gzipSync(readFileSync(join(OUT, path)), {level: GZIP_LEVEL_HOST_TRANSIT}).length;
}

function formatSize(bytes: number): string {
    return bytes < MB ? `${(bytes / KB).toFixed(1)} KiB` : `${(bytes / MB).toFixed(2)} MB`;
}

function report(manifest: Demo3dManifest): void {
    const site = outputFiles(OUT).map(siteRelative).sort();
    for (const path of site.filter(path => !path.startsWith("demo/"))) {
        const gzipped = /\.(js|css|html)$/.test(path) ? `  (gzip ${(transitGzippedSizeOf(path) / KB).toFixed(1)} KiB)` : "";
        console.log(`${path}  ${(sizeOf(path) / KB).toFixed(1)} KiB${gzipped}`);
    }
    const assets = site.filter(path => path.startsWith("demo/"));
    const compressed = manifest.files.filter(file => file.gzipParts !== undefined);
    console.log(`3D assets: ${assets.length} files, ${formatSize(assets.reduce((sum, path) => sum + sizeOf(path), 0))}`
        + (compressed.length === 0 ? "" : `; gzip-compressed: ${compressed.map(file => `${file.path} ${formatSize(file.size)} -> ${formatSize(transferBytes(file))} in ${file.gzipParts!.length} part(s)`).join(", ")}`));

    const eager = manifest.files.filter(file => file.lazy !== true);
    const eagerBytes = eager.reduce((sum, file) => sum + transferBytes(file), 0);
    for (const {page, files, fetchesDemo3dAssets} of FIRST_LOADS) {
        const assetBytes = fetchesDemo3dAssets ? eagerBytes : 0;
        const onDisk = files.reduce((sum, path) => sum + sizeOf(path), 0) + assetBytes;
        const gzipped = files.reduce((sum, path) => sum + transitGzippedSizeOf(path), 0) + assetBytes;
        console.log(`first load ${page}: ${formatSize(onDisk)} (${formatSize(gzipped)} with text gzipped in transit)`
            + (assetBytes === 0 ? "" : `, of which ${eager.filter(file => file.statOnly !== true).length} 3D assets ${formatSize(assetBytes)}`));
    }
    const byPath = new Map(manifest.files.map(file => [file.path, file]));
    for (const model of manifest.models) {
        const lazy = model.files.map(path => byPath.get(path)!).filter(file => file.lazy === true);
        if (lazy.length > 0) console.log(`lazy model ${model.name}: ${formatSize(lazy.reduce((sum, file) => sum + transferBytes(file), 0))} fetched when first selected or spawned`);
    }
    console.log(`site: ${site.length} files, ${formatSize(site.reduce((sum, path) => sum + sizeOf(path), 0))} total`);
}

async function buildEachEntrySeparately(): Promise<void> {
    for (const {source, output} of BUILT_ENTRY_POINTS) {
        const result = await Bun.build({
            entrypoints: [source],
            outdir: OUT,
            naming: `${output}.${OUTPUT_EXTENSION_PLACEHOLDER}`,
            target: "browser",
            sourcemap: "linked",
            minify: PROD,
        });
        if (!result.success) {
            for (const message of result.logs) console.error(message);
            process.exit(1);
        }
    }
}

async function main(): Promise<void> {
    rmSync(OUT, {recursive: true, force: true});
    mkdirSync(OUT, {recursive: true});

    await buildEachEntrySeparately();
    for (const [from, to] of COPIED_STATIC_FILES) copyFileSync(from, join(OUT, to));
    writeFileSync(join(OUT, GITHUB_PAGES_NO_JEKYLL), "");
    const manifest = writeDemo3dAssets();

    const scripts = outputFiles(OUT).filter(path => path.endsWith(".js"));
    const found = scripts.flatMap(leaks);
    if (found.length > 0) {
        console.error("node APIs leaked into the browser bundle:");
        for (const leak of found) console.error("  " + leak);
        process.exit(1);
    }

    const textByEntry = bundleTexts();
    const mixed = backendLeaks(textByEntry);
    if (mixed.length > 0) {
        console.error("a bundle mixes the cells and pixels backends:");
        for (const leak of mixed) console.error("  " + leak);
        process.exit(1);
    }

    const misplacedEditor = editorProtocolMisplaced(textByEntry);
    if (misplacedEditor.length > 0) {
        console.error("the editor protocol is in the wrong bundles:");
        for (const leak of misplacedEditor) console.error("  " + leak);
        process.exit(1);
    }

    console.log(`${PROD ? "production" : "dev"} build in ${relative(ROOT, OUT).replace(/\\/g, "/")}`);
    report(manifest);
    const editorBundles = BUILT_ENTRY_POINTS.filter(entry => roleOf(entry) === "editor").length;
    console.log(`guard OK: ${scripts.length} script(s) free of node APIs; ${BUILT_ENTRY_POINTS.length} bundles each carry no other backend's presenter; `
        + `${BUILT_ENTRY_POINTS.length - editorBundles} game bundles free of "${EDITOR_MESSAGE_TYPE}", ${editorBundles} editor bundles carry it`
        + (WITH_EDITOR ? "" : " (editor page and bundles skipped: --prod without --with-editor)"));
}

void main();
