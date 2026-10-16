/**
 * Bundles web/ for the browser into a static site, then fails if any node API leaked into the
 * output. Also writes the 3D demo's asset manifest (demo/3d/assets.ts) and copies the files it
 * lists to the same relative paths in the site, where the world worker fetches them.
 *
 * Run: bun scripts/buildWeb.ts          dev build into web/dist: readable bundles, assets as they are
 *      bun scripts/buildWeb.ts --prod   upload-ready build into web/dist-prod: minified bundles, and
 *      assets gzip-compressed where that pays, split into parts no host's file size limit rejects
 *
 * Both write the same pages, `_headers` (COOP/COEP for hosts that read it) and the vendored
 * coi-serviceworker (isolation after one reload on hosts that do not). Source maps are external
 * `.map` files, linked from each bundle, so only devtools fetches them.
 */
import type {BunPlugin} from "bun";
import {copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, extname, join, relative, resolve} from "path";
import {gzipSync} from "zlib";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest, ManifestFile} from "../demo/3d/assets";

const ROOT = resolve(__dirname, "..");
const WEB = join(ROOT, "web");
const PROD = process.argv.includes("--prod");
const OUT = join(WEB, PROD ? "dist-prod" : "dist");
/** Each page script owns the terminal and spawns its world worker (`<name>.worker.js` beside it). */
const ENTRY_POINTS = ["2d.ts", "world2d.worker.ts", "3d.ts", "world3d.worker.ts"].map(name => join(WEB, name));
const STATIC_FILES: readonly [from: string, to: string][] = [
    ...["index.html", "2d.html", "3d.html", "demo.css", "coi-serviceworker.js", "_headers"].map((name): [string, string] => [join(WEB, name), name]),
    [join(ROOT, "node_modules", "@xterm", "xterm", "css", "xterm.css"), "xterm.css"],
];
/** Tells GitHub Pages to serve the site as it is rather than through Jekyll. */
const NO_JEKYLL = ".nojekyll";

/** Fetched by web/3d.ts, relative to the page. */
const MANIFEST_3D = "3d-manifest.json";
const KB = 1024;
const MB = 1024 * 1024;

/** Every file a page fetches before its first frame, besides the 3D world's eager assets. */
const PAGE_LOADS: Readonly<Record<string, readonly string[]>> = {
    "index.html": ["index.html", "coi-serviceworker.js"],
    "2d.html": ["2d.html", "xterm.css", "demo.css", "2d.js", "world2d.worker.js"],
    "3d.html": ["3d.html", "coi-serviceworker.js", "xterm.css", "demo.css", "3d.js", "world3d.worker.js", MANIFEST_3D],
};

/** Production assets are gzip-compressed when that saves at least this share, and only from this size up. */
const MIN_GZIP_SAVING = 0.1;
const MIN_GZIP_BYTES = 64 * KB;
/** Formats that are compressed already. */
const PRECOMPRESSED = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".gz", ".zip"]);
/** Compressed assets are split into parts of at most this size: Cloudflare Pages rejects files over 25 MiB. */
const GZIP_PART_BYTES = 20 * MB;

const NODE_PLATFORM = join(ROOT, "src", "js_engine", "platform", "nodePlatform");
const NODE_PLATFORM_STUB = join(WEB, "nodePlatformStub.ts");

const FORBIDDEN: readonly [label: string, pattern: RegExp][] = [
    ["node module require", /require\(\s*["'](node:)?(fs|path|os|zlib|worker_threads|util)["']\s*\)/],
    ["node: specifier", /["']node:[\w/]+["']/],
    ["process stdio", /process\.(stdout|stdin)/],
    ["fileLogger", /crash-logs/],
];

function sameModule(a: string, b: string): boolean {
    const strip = (path: string) => path.replace(/\.ts$/, "").toLowerCase();
    return strip(resolve(a)) === strip(resolve(b));
}

const replaceNodePlatform: BunPlugin = {
    name: "replace-node-platform",
    setup(build) {
        build.onResolve({filter: /(^|[\\/])nodePlatform$/}, args => {
            if (!sameModule(resolve(dirname(args.importer), args.path), NODE_PLATFORM)) return undefined;
            return {path: NODE_PLATFORM_STUB};
        });
    },
};

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

/** Writes `bytes` gzip-compressed as `<target>.gz.part0`, `.part1`...; the part sizes, or undefined where gzip does not pay. */
function writeGzipParts(bytes: Uint8Array, target: string): number[] | undefined {
    const compressed = gzipSync(bytes, {level: 9});
    if (compressed.length > bytes.length * (1 - MIN_GZIP_SAVING)) return undefined;
    const parts: number[] = [];
    for (let offset = 0; offset < compressed.length; offset += GZIP_PART_BYTES) {
        const part = compressed.subarray(offset, offset + GZIP_PART_BYTES);
        writeFileSync(`${target}.gz.part${parts.length}`, part);
        parts.push(part.length);
    }
    return parts;
}

function shouldGzip(file: ManifestFile): boolean {
    return PROD && file.size >= MIN_GZIP_BYTES && !PRECOMPRESSED.has(extname(file.path).toLowerCase());
}

/** Bytes a host transfers for the entry: its gzip parts if it has them, else the file. */
function transferBytes(file: ManifestFile): number {
    if (file.statOnly === true) return 0;
    return file.gzipParts?.reduce((sum, part) => sum + part, 0) ?? file.size;
}

function writeDemo3dAssets(): Demo3dManifest {
    const built = buildDemo3dManifest(ROOT);
    const files = built.files.map((file): ManifestFile => {
        if (file.statOnly === true) return file;
        const target = join(OUT, file.path);
        mkdirSync(dirname(target), {recursive: true});
        if (shouldGzip(file)) {
            const gzipParts = writeGzipParts(readFileSync(join(ROOT, file.path)), target);
            if (gzipParts !== undefined) return {...file, gzipParts};
        }
        copyFileSync(join(ROOT, file.path), target);
        return file;
    });
    const manifest: Demo3dManifest = {models: built.models, files};
    writeFileSync(join(OUT, MANIFEST_3D), JSON.stringify(manifest, null, PROD ? undefined : 1));
    return manifest;
}

function sizeOf(path: string): number {
    return statSync(join(OUT, path)).size;
}

/** What a host that gzips text in transit (they all do) would send for the site file at `path`. */
function gzippedSizeOf(path: string): number {
    if (!/\.(html|css|js|json)$/.test(path)) return sizeOf(path);
    return gzipSync(readFileSync(join(OUT, path)), {level: 6}).length;
}

function megabytes(bytes: number): string {
    return bytes < MB ? `${(bytes / KB).toFixed(1)} KiB` : `${(bytes / MB).toFixed(2)} MB`;
}

function report(manifest: Demo3dManifest): void {
    const site = outputFiles(OUT).map(siteRelative).sort();
    for (const path of site.filter(path => !path.startsWith("demo/"))) {
        const gzipped = /\.(js|css|html)$/.test(path) ? `  (gzip ${(gzippedSizeOf(path) / KB).toFixed(1)} KiB)` : "";
        console.log(`${path}  ${(sizeOf(path) / KB).toFixed(1)} KiB${gzipped}`);
    }
    const assets = site.filter(path => path.startsWith("demo/"));
    const compressed = manifest.files.filter(file => file.gzipParts !== undefined);
    console.log(`3D assets: ${assets.length} files, ${megabytes(assets.reduce((sum, path) => sum + sizeOf(path), 0))}`
        + (compressed.length === 0 ? "" : `; gzip-compressed: ${compressed.map(file => `${file.path} ${megabytes(file.size)} -> ${megabytes(transferBytes(file))} in ${file.gzipParts!.length} part(s)`).join(", ")}`));

    const eager = manifest.files.filter(file => file.lazy !== true);
    const eagerBytes = eager.reduce((sum, file) => sum + transferBytes(file), 0);
    for (const [page, files] of Object.entries(PAGE_LOADS)) {
        const assetBytes = page === "3d.html" ? eagerBytes : 0;
        const onDisk = files.reduce((sum, path) => sum + sizeOf(path), 0) + assetBytes;
        const gzipped = files.reduce((sum, path) => sum + gzippedSizeOf(path), 0) + assetBytes;
        console.log(`first load ${page}: ${megabytes(onDisk)} (${megabytes(gzipped)} with text gzipped in transit)`
            + (assetBytes === 0 ? "" : `, of which ${eager.filter(file => file.statOnly !== true).length} 3D assets ${megabytes(assetBytes)}`));
    }
    const byPath = new Map(manifest.files.map(file => [file.path, file]));
    for (const model of manifest.models) {
        const lazy = model.files.map(path => byPath.get(path)!).filter(file => file.lazy === true);
        if (lazy.length > 0) console.log(`lazy model ${model.name}: ${megabytes(lazy.reduce((sum, file) => sum + transferBytes(file), 0))} fetched when first selected or spawned`);
    }
    console.log(`site: ${site.length} files, ${megabytes(site.reduce((sum, path) => sum + sizeOf(path), 0))} total`);
}

async function main(): Promise<void> {
    rmSync(OUT, {recursive: true, force: true});
    mkdirSync(OUT, {recursive: true});

    // One build per entry: bun bundling several entry points together (without splitting) puts
    // modules only one of them reaches into every bundle (the 2D page grew the 3D renderer).
    for (const entryPoint of ENTRY_POINTS) {
        const result = await Bun.build({
            entrypoints: [entryPoint],
            outdir: OUT,
            target: "browser",
            sourcemap: "linked",
            minify: PROD,
            plugins: [replaceNodePlatform],
        });
        if (!result.success) {
            for (const message of result.logs) console.error(message);
            process.exit(1);
        }
    }
    for (const [from, to] of STATIC_FILES) copyFileSync(from, join(OUT, to));
    writeFileSync(join(OUT, NO_JEKYLL), "");
    const manifest = writeDemo3dAssets();

    const scripts = outputFiles(OUT).filter(path => path.endsWith(".js"));
    const found = scripts.flatMap(leaks);
    if (found.length > 0) {
        console.error("node APIs leaked into the browser bundle:");
        for (const leak of found) console.error("  " + leak);
        process.exit(1);
    }

    console.log(`${PROD ? "production" : "dev"} build in ${relative(ROOT, OUT).replace(/\\/g, "/")}`);
    report(manifest);
    console.log(`guard OK: ${scripts.length} script(s) free of node APIs`);
}

void main();
