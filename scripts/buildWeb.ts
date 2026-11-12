import type {BunPlugin} from "bun";
import {copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, extname, join, relative, resolve} from "path";
import {gzipSync} from "zlib";
import {buildDemo3dManifest} from "../demo/3d/assets";
import type {Demo3dManifest, ManifestFile} from "../demo/3d/assets";

const ROOT = resolve(__dirname, "..");
const WEB = join(ROOT, "src", "hosts", "web");
const PROD = process.argv.includes("--prod");
const OUT = join(ROOT, "dist", PROD ? "web-prod" : "web");
const ENTRY_POINTS = ["2d.ts", "world2d.worker.ts", "3d.ts", "world3d.worker.ts"].map(name => join(WEB, name));
const STATIC_FILES: readonly [from: string, to: string][] = [
    ...["index.html", "2d.html", "3d.html", "demo.css", "coi-serviceworker.js", "_headers"].map((name): [string, string] => [join(WEB, name), name]),
    [join(ROOT, "node_modules", "@xterm", "xterm", "css", "xterm.css"), "xterm.css"],
];
const GITHUB_PAGES_NO_JEKYLL = ".nojekyll";

const MANIFEST_3D = "3d-manifest.json";
const KB = 1024;
const MB = 1024 * 1024;
const DEV_MANIFEST_INDENT_SPACES = 1;

const FIRST_LOAD_FILES_BY_PAGE: Readonly<Record<string, readonly string[]>> = {
    "index.html": ["index.html", "coi-serviceworker.js"],
    "2d.html": ["2d.html", "xterm.css", "demo.css", "2d.js", "world2d.worker.js"],
    "3d.html": ["3d.html", "coi-serviceworker.js", "xterm.css", "demo.css", "3d.js", "world3d.worker.js", MANIFEST_3D],
};

const MIN_GZIP_SAVING_FRACTION = 0.1;
const MIN_GZIP_BYTES = 64 * KB;
const PRECOMPRESSED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".gz", ".zip"]);
const GZIP_PART_BYTES = 20 * MB;
const GZIP_LEVEL_MAX = 9;
const GZIP_LEVEL_HOST_TRANSIT = 6;

const NODE_PLATFORM = join(ROOT, "src", "hosts", "terminal", "nodePlatform");
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
    const built = buildDemo3dManifest(ROOT);
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
    for (const [page, files] of Object.entries(FIRST_LOAD_FILES_BY_PAGE)) {
        const assetBytes = page === "3d.html" ? eagerBytes : 0;
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
}

async function main(): Promise<void> {
    rmSync(OUT, {recursive: true, force: true});
    mkdirSync(OUT, {recursive: true});

    await buildEachEntrySeparately();
    for (const [from, to] of STATIC_FILES) copyFileSync(from, join(OUT, to));
    writeFileSync(join(OUT, GITHUB_PAGES_NO_JEKYLL), "");
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
