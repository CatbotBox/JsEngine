import {FuseV1Options, FuseVersion, flipFuses} from "@electron/fuses";
import {packager} from "@electron/packager";
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join, relative} from "path";
import {deflateRawSync} from "zlib";
import type {PackagedLaunch} from "../src/hosts/desktop/main";
import {
    APP_ICON_DIRECTORY,
    APP_ICON_ICNS_FILE,
    APP_ICON_ICO_FILE,
    APP_ICON_PNG_FILE,
    buildWeb,
    bundleMainProcess,
    ROOT,
    WEB_DIST,
    WINDOW_DIST,
} from "./windowBuild";
import {isEditorSiteFile, pageNameFromArgumentsOrUndefined, sitePathOfPage} from "./webDistFiles";
import {zipDirectory} from "./zipArchive";

const DEFAULT_PAGE_NAME = "3d";
const STAGING = join(WINDOW_DIST, "app");
const RELEASE = join(ROOT, "release");
const STAGED_WINDOW_ICON_FILE = "icon.png";
const PLATFORM = process.platform;
const ARCH = process.arch;
const WORD_SEPARATORS = / +/g;
const ZIP_EXTENSION = ".zip";
const NO_BUILD_FLAG = "--no-build";
const NO_ZIP_FLAG = "--no-zip";

const PRODUCT_TITLES_BY_PAGE_NAME: Readonly<Record<string, string>> = {
    "2d": "JsEngine 2D",
    "2d-pixels": "JsEngine 2D",
    "3d": "JsEngine 3D",
    "3d-pixels": "JsEngine 3D",
    "swarm": "JsEngine Swarm",
    "swarm-pixels": "JsEngine Swarm",
};

const ICON_FILES_BY_PLATFORM: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
    win32: APP_ICON_ICO_FILE,
    darwin: APP_ICON_ICNS_FILE,
};

interface RootManifest {
    readonly version: string;
    readonly author: string;
}

interface Product {
    readonly title: string;
    readonly slug: string;
    readonly executableName: string;
    readonly version: string;
    readonly author: string;
    readonly copyright: string;
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

function productFor(pageName: string): Product {
    const title = PRODUCT_TITLES_BY_PAGE_NAME[pageName];
    if (title === undefined) throw new Error(`no packaged product for page "${pageName}"`);
    const {version, author} = readJson<RootManifest>(join(ROOT, "package.json"));
    const slug = title.toLowerCase().replace(WORD_SEPARATORS, "-");
    return {
        title,
        slug,
        executableName: PLATFORM === "linux" ? slug : title,
        version,
        author,
        copyright: `Copyright (c) ${new Date().getFullYear()} ${author}`,
    };
}

function iconPath(): string {
    const path = join(APP_ICON_DIRECTORY, ICON_FILES_BY_PLATFORM[PLATFORM] ?? APP_ICON_PNG_FILE);
    if (!existsSync(path)) {
        console.error(`${relative(ROOT, path)} is missing; run bun run icon:generate`);
        process.exit(1);
    }
    return path;
}

function fusedBinaryPath(packagedDirectory: string, product: Product): string {
    if (PLATFORM === "win32") return join(packagedDirectory, `${product.executableName}.exe`);
    if (PLATFORM === "darwin") return join(packagedDirectory, `${product.title}.app`);
    return join(packagedDirectory, product.executableName);
}

async function hardenExecutable(packagedDirectory: string, product: Product): Promise<void> {
    await flipFuses(fusedBinaryPath(packagedDirectory, product), {
        version: FuseVersion.V1,
        resetAdHocDarwinSignature: PLATFORM === "darwin" && ARCH === "arm64",
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
}

async function stageApp(page: string, product: Product): Promise<void> {
    rmSync(STAGING, {recursive: true, force: true});
    mkdirSync(STAGING, {recursive: true});
    await bundleMainProcess(STAGING);
    const launch: PackagedLaunch = {page, title: product.title, iconFile: STAGED_WINDOW_ICON_FILE};
    writeFileSync(join(STAGING, "launch.json"), JSON.stringify(launch));
    writeFileSync(join(STAGING, "package.json"), JSON.stringify({
        name: product.slug,
        productName: product.title,
        version: product.version,
        author: product.author,
        main: "main.js",
    }, null, 2));
    copyFileSync(join(APP_ICON_DIRECTORY, APP_ICON_PNG_FILE), join(STAGING, STAGED_WINDOW_ICON_FILE));
    cpSync(WEB_DIST, join(STAGING, "web"), {recursive: true, filter: source => !source.endsWith(".map") && !isEditorSiteFile(relative(WEB_DIST, source))});
}

function releaseRelative(path: string): string {
    return relative(ROOT, path).replace(/\\/g, "/");
}

function zipRelease(packagedDirectory: string, product: Product): string {
    const stem = `${product.title.replace(WORD_SEPARATORS, "-")}-${product.version}-${PLATFORM}-${ARCH}`;
    const zipPath = join(RELEASE, stem + ZIP_EXTENSION);
    zipDirectory(packagedDirectory, zipPath, stem, bytes => new Uint8Array(deflateRawSync(bytes)));
    return zipPath;
}

async function main(): Promise<void> {
    const pageName = pageNameFromArgumentsOrUndefined() ?? DEFAULT_PAGE_NAME;
    const page = sitePathOfPage(pageName);
    if (isEditorSiteFile(page)) {
        console.error(`${page} is the editor, which packaged apps leave out; package a game page instead`);
        process.exit(1);
    }
    const product = productFor(pageName);
    const icon = iconPath();
    if (!process.argv.includes(NO_BUILD_FLAG)) buildWeb();
    await stageApp(page, product);
    const [output] = await packager({
        dir: STAGING,
        out: RELEASE,
        name: product.title,
        executableName: product.executableName,
        appVersion: product.version,
        appCopyright: product.copyright,
        icon,
        win32metadata: {
            CompanyName: product.author,
            FileDescription: product.title,
            ProductName: product.title,
            InternalName: product.executableName,
            OriginalFilename: `${product.executableName}.exe`,
        },
        electronVersion: readJson<{version: string}>(join(ROOT, "node_modules", "electron", "package.json")).version,
        asar: true,
        prune: false,
        overwrite: true,
        quiet: true,
    });
    await hardenExecutable(output, product);
    console.log(`packaged ${page} as ${product.title} into ${releaseRelative(output)}`);
    if (process.argv.includes(NO_ZIP_FLAG)) return;
    console.log(`zipped into ${releaseRelative(zipRelease(output, product))}`);
}

void main();
