/**
 * Bundles web/ for the browser into web/dist, then fails if any node API leaked into the output.
 *
 * Run: bun scripts/buildWeb.ts
 */
import type {BunPlugin} from "bun";
import {copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync} from "fs";
import {dirname, join, resolve} from "path";

const ROOT = resolve(__dirname, "..");
const WEB = join(ROOT, "web");
const DIST = join(WEB, "dist");
const ENTRY_POINTS = [join(WEB, "2d.ts")];
const STATIC_FILES: readonly [from: string, to: string][] = [
    [join(WEB, "index.html"), "index.html"],
    [join(ROOT, "node_modules", "@xterm", "xterm", "css", "xterm.css"), "xterm.css"],
];

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

function leaks(path: string): string[] {
    const text = readFileSync(path, "utf8");
    return FORBIDDEN.flatMap(([label, pattern]) => {
        const match = pattern.exec(text);
        if (match === null) return [];
        const line = text.slice(0, match.index).split("\n").length;
        return [`${path}:${line}: ${label}: ${match[0]}`];
    });
}

async function main(): Promise<void> {
    rmSync(DIST, {recursive: true, force: true});
    mkdirSync(DIST, {recursive: true});

    const result = await Bun.build({
        entrypoints: ENTRY_POINTS,
        outdir: DIST,
        target: "browser",
        sourcemap: "linked",
        plugins: [replaceNodePlatform],
    });
    if (!result.success) {
        for (const message of result.logs) console.error(message);
        process.exit(1);
    }
    for (const [from, to] of STATIC_FILES) copyFileSync(from, join(DIST, to));

    const scripts = outputFiles(DIST).filter(path => path.endsWith(".js"));
    const found = scripts.flatMap(leaks);
    if (found.length > 0) {
        console.error("node APIs leaked into the browser bundle:");
        for (const leak of found) console.error("  " + leak);
        process.exit(1);
    }

    for (const path of outputFiles(DIST)) {
        console.log(`${path.slice(ROOT.length + 1).replace(/\\/g, "/")}  ${(statSync(path).size / 1024).toFixed(1)} KiB`);
    }
    console.log(`guard OK: ${scripts.length} script(s) free of node APIs`);
}

void main();
