import {FuseV1Options, FuseVersion, flipFuses} from "@electron/fuses";
import {packager} from "@electron/packager";
import {copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "fs";
import {join} from "path";
import {deflateRawSync} from "zlib";
import type {PackagedLaunch} from "../../editor/desktop";
import {CliError} from "../cliArguments";
import {APP_ICON_DIRECTORY, APP_ICON_ICNS_FILE, APP_ICON_ICO_FILE, APP_ICON_PNG_FILE, bundleMainProcess} from "../build/windowBuild";
import {readProjectManifest} from "../project";
import {projectSlug, slugOf} from "../projectLayout";
import {builtProjectSite} from "../projectSites";
import {RELEASE_DIRECTORY, repoRelative, REPO_ROOT, WEB_DIST, WINDOW_DIST} from "../repoPaths";
import {zipDirectory} from "./zipArchive";

export interface WindowPackageOptions {
    readonly project: string;
    readonly page: string;
    readonly zip: boolean;
}

const STAGING = join(WINDOW_DIST, "app");
const STAGED_SITE_FOLDER = "web";
const STAGED_WINDOW_ICON_FILE = "icon.png";
const SOURCE_MAP_EXTENSION = ".map";
const PLATFORM = process.platform;
const ARCH = process.arch;
const WORD_SEPARATORS = / +/g;
const FILE_NAME_UNSAFE_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const FILE_NAME_TRAILING_DOTS_AND_SPACES = /[. ]+$/;
const FILE_NAME_REPLACEMENT = "-";
const ZIP_EXTENSION = ".zip";
const ICON_GENERATOR_COMMAND = "bun scripts/generateAppIcon.ts";

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
    readonly fileName: string;
    readonly slug: string;
    readonly executableName: string;
    readonly version: string;
    readonly author: string;
    readonly copyright: string;
}

function readJson<T>(path: string): T {
    return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fileNameOf(title: string): string {
    return title.replace(FILE_NAME_UNSAFE_CHARACTERS, FILE_NAME_REPLACEMENT).replace(FILE_NAME_TRAILING_DOTS_AND_SPACES, "");
}

function productFor(project: string): Product {
    const title = readProjectManifest(project).name;
    const {version, author} = readJson<RootManifest>(join(REPO_ROOT, "package.json"));
    const titleSlug = slugOf(title);
    const slug = titleSlug.length > 0 ? titleSlug : projectSlug(project);
    const titleFileName = fileNameOf(title);
    const fileName = titleFileName.length > 0 ? titleFileName : slug;
    return {
        title,
        fileName,
        slug,
        executableName: PLATFORM === "linux" ? slug : fileName,
        version,
        author,
        copyright: `Copyright (c) ${new Date().getFullYear()} ${author}`,
    };
}

function iconPath(): string {
    const path = join(APP_ICON_DIRECTORY, ICON_FILES_BY_PLATFORM[PLATFORM] ?? APP_ICON_PNG_FILE);
    if (!existsSync(path)) throw new CliError(`${repoRelative(path)} is missing; run ${ICON_GENERATOR_COMMAND}`);
    return path;
}

function fusedBinaryPath(packagedDirectory: string, product: Product): string {
    if (PLATFORM === "win32") return join(packagedDirectory, `${product.executableName}.exe`);
    if (PLATFORM === "darwin") return join(packagedDirectory, `${product.fileName}.app`);
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

async function stageApp(project: string, page: string, product: Product): Promise<void> {
    const site = builtProjectSite(WEB_DIST, project);
    rmSync(STAGING, {recursive: true, force: true});
    mkdirSync(STAGING, {recursive: true});
    await bundleMainProcess(STAGING);
    const launch: PackagedLaunch = {page, title: product.title, iconFile: STAGED_WINDOW_ICON_FILE};
    writeFileSync(join(STAGING, "launch.json"), JSON.stringify(launch));
    writeFileSync(join(STAGING, "package.json"), JSON.stringify({
        name: product.slug,
        productName: product.fileName,
        version: product.version,
        author: product.author,
        main: "main.js",
    }, null, 2));
    copyFileSync(join(APP_ICON_DIRECTORY, APP_ICON_PNG_FILE), join(STAGING, STAGED_WINDOW_ICON_FILE));
    cpSync(site, join(STAGING, STAGED_SITE_FOLDER, projectSlug(project)), {recursive: true, filter: source => !source.endsWith(SOURCE_MAP_EXTENSION)});
}

function zipRelease(packagedDirectory: string, product: Product): string {
    const stem = `${product.fileName.replace(WORD_SEPARATORS, "-")}-${product.version}-${PLATFORM}-${ARCH}`;
    const zipPath = join(RELEASE_DIRECTORY, stem + ZIP_EXTENSION);
    zipDirectory(packagedDirectory, zipPath, stem, bytes => new Uint8Array(deflateRawSync(bytes)));
    return zipPath;
}

export function checkWindowPackageInputs(): void {
    iconPath();
}

export async function packageWindow(options: WindowPackageOptions): Promise<void> {
    const product = productFor(options.project);
    const icon = iconPath();
    await stageApp(options.project, options.page, product);
    const [output] = await packager({
        dir: STAGING,
        out: RELEASE_DIRECTORY,
        name: product.fileName,
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
        electronVersion: readJson<{version: string}>(join(REPO_ROOT, "node_modules", "electron", "package.json")).version,
        asar: true,
        prune: false,
        overwrite: true,
        quiet: true,
    });
    await hardenExecutable(output, product);
    console.log(`packaged ${options.page} as ${product.title} into ${repoRelative(output)}`);
    if (!options.zip) return;
    console.log(`zipped into ${repoRelative(zipRelease(output, product))}`);
}
