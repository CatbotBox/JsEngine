import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, extname, join, relative} from "path";
import {gzipSync} from "zlib";
import {nodePlatform} from "../../hosts/terminal";
import {RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {EDITOR_MESSAGE_TYPE} from "../../editor/editorProtocol";
import {DEV_RELOAD_DEFINE} from "../../hosts/web/devReload";
import {projectAssetManifestPath} from "../../hosts/web/webProjectAssets";
import type {AssetManifestFile, ProjectAssetManifest} from "../../hosts/web/webProjectAssets";
import {PROJECT_MANIFEST_FILE} from "../../engine/project/projectManifest";
import {CliError} from "../cliArguments";
import {DEMO_SITES, demoSiteFolder} from "../demoSites";
import type {DemoSite} from "../demoSites";
import {writeGeneratedFiles} from "../generate/generatedFiles";
import {
    projectSiteDirectory,
    projectSlug,
    WEB_PAGE_BOOTSTRAP_FILE,
    webBundleFile,
    webPageBootstrapBundle,
    webPageBundle,
    webPageMainFile,
    webWorkerBundle,
    webWorkerMainFile,
} from "../projectLayout";
import {REPO_ROOT, repoRelative, SOURCE_ROOT, webDistOf} from "../repoPaths";
import {featureDefines} from "../targets";
import type {HostTarget} from "../targets";
import {isWebProjectDataFile} from "./webDistFiles";
import {buildProjectAssetManifest, projectAssetRegistry} from "./projectAssets";
import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {bundleInputsOf, requireMetafile} from "./bundleMetafile";
import type {MetafileBuildConfig, MetafileBuildOutput} from "./bundleMetafile";
import {checkBundleFeatures, targetFeatureReport} from "./featureDetection";
import type {FeatureCheckBundle, TargetFeatureReport} from "./featureDetection";

export interface WebBuildOptions {
    readonly prod: boolean;
    readonly withEditor: boolean;
    readonly target: HostTarget;
}

const WEB = join(SOURCE_ROOT, "hosts", "web");
const DEMO = join(REPO_ROOT, "demo");
const EDITOR_LAUNCH = join(SOURCE_ROOT, "editor", "launch");

type BundleRole = "game" | "editor";

interface EntryPoint {
    readonly source: string;
    readonly output: string;
    readonly backend?: RenderBackendKind;
    readonly role?: BundleRole;
}

interface SiteProject {
    readonly site: DemoSite;
    readonly folder: string;
    readonly slug: string;
    readonly directory: string;
}

interface BuiltAssets {
    readonly project: SiteProject;
    readonly manifest: ProjectAssetManifest;
}

const EDITOR_ENTRY: EntryPoint = {source: join(EDITOR_LAUNCH, "editor.ts"), output: "editor", backend: "pixels", role: "editor"};
const DEFAULT_BUNDLE_ROLE: BundleRole = "game";
const OUTPUT_EXTENSION_PLACEHOLDER = "[ext]";
const LANDING_PAGE = "index.html";
const STATIC_FILES: readonly [from: string, to: string][] =
    [LANDING_PAGE, "2d.html", "3d.html", "swarm.html", "demo.css", "coi-serviceworker.js", "_headers"].map((name): [string, string] => [join(WEB, name), name]);
const EDITOR_STATIC_FILES: readonly [from: string, to: string][] =
    ["editor.html", "editor.css", "editorStart.css"].map((name): [string, string] => [join(EDITOR_LAUNCH, name), name]);
const GITHUB_PAGES_NO_JEKYLL = ".nojekyll";
const PAGE_RESOURCE_REFERENCE = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g;
const EXTERNAL_REFERENCE = /^[a-z]+:|^\/\//i;

const KB = 1024;
const MB = 1024 * 1024;
const DEV_MANIFEST_INDENT_SPACES = 1;

interface FirstLoad {
    readonly page: string;
    readonly files: readonly string[];
    readonly projectDirectory?: string;
}

const PROJECT_FOLDERS_LEFT_OUT: ReadonlySet<string> = new Set([".jsengine", "node_modules"]);
const SITE_PATH_SEPARATOR = "/";
const BACKEND_QUERY = "?backend=";

const MIN_GZIP_SAVING_FRACTION = 0.1;
const MIN_GZIP_BYTES = 64 * KB;
const PRECOMPRESSED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".gz", ".zip"]);
const GZIP_PART_BYTES = 20 * MB;
const GZIP_LEVEL_MAX = 9;
const GZIP_LEVEL_HOST_TRANSIT = 6;
const PAGES_MAX_FILE_BYTES = 25 * MB;
const PAGES_MAX_FILES = 20_000;

function outputFiles(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? outputFiles(path) : [path];
    });
}

function roleOf(entry: EntryPoint): BundleRole {
    return entry.role ?? DEFAULT_BUNDLE_ROLE;
}

function transferBytes(file: AssetManifestFile): number {
    if (file.statOnly === true) return 0;
    return file.gzipParts?.reduce((sum, part) => sum + part, 0) ?? file.size;
}

function upFrontFiles(manifest: ProjectAssetManifest): AssetManifestFile[] {
    return manifest.files.filter(file => file.statOnly !== true && file.lazy !== true);
}

function projectDataFilesUnder(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return PROJECT_FOLDERS_LEFT_OUT.has(entry.name) ? [] : projectDataFilesUnder(path);
        return isWebProjectDataFile(entry.name) ? [path] : [];
    });
}

function isProjectDataSitePath(path: string): boolean {
    return path.startsWith("demo/") && isWebProjectDataFile(path);
}

function formatSize(bytes: number): string {
    return bytes < MB ? `${(bytes / KB).toFixed(1)} KiB` : `${(bytes / MB).toFixed(2)} MB`;
}

function guard(problems: readonly string[], message: string): void {
    if (problems.length > 0) throw new CliError(message, problems);
}

function siteProjectOf(site: DemoSite): SiteProject {
    const folder = demoSiteFolder(site);
    return {site, folder, slug: projectSlug(folder), directory: projectSiteDirectory(folder)};
}

function projectEntries(project: SiteProject): EntryPoint[] {
    return [
        {source: join(project.folder, WEB_PAGE_BOOTSTRAP_FILE), output: webPageBootstrapBundle(project.slug)},
        ...RENDER_BACKEND_KINDS.flatMap((backend): EntryPoint[] => [
            {source: join(project.folder, webPageMainFile(backend)), output: webPageBundle(project.slug, backend), backend},
            {source: join(project.folder, webWorkerMainFile(backend)), output: webWorkerBundle(project.slug, backend), backend},
        ]),
    ];
}

class WebSiteBuild {
    private readonly out: string;
    private readonly projects: readonly SiteProject[];
    private readonly entries: readonly EntryPoint[];
    private readonly featureChecks: FeatureCheckBundle[] = [];

    public constructor(private readonly options: WebBuildOptions) {
        this.out = webDistOf(options.prod);
        this.projects = DEMO_SITES.map(siteProjectOf);
        this.entries = [...this.projects.flatMap(projectEntries), ...(options.withEditor ? [EDITOR_ENTRY] : [])];
    }

    public async run(): Promise<TargetFeatureReport> {
        rmSync(this.out, {recursive: true, force: true});
        mkdirSync(this.out, {recursive: true});

        await this.buildEachEntrySeparately();
        const staticFiles = this.options.withEditor ? [...STATIC_FILES, ...EDITOR_STATIC_FILES] : STATIC_FILES;
        for (const [from, to] of staticFiles) copyFileSync(from, join(this.out, to));
        writeFileSync(join(this.out, GITHUB_PAGES_NO_JEKYLL), "");
        const assets: BuiltAssets[] = [];
        for (const project of this.projects) assets.push({project, manifest: await this.writeProjectAssets(project)});
        this.writeDemoProjectDataFiles();

        guard(this.editorProtocolMisplaced(this.bundleTexts()), "the editor protocol is in the wrong bundles:");
        guard(this.options.prod ? this.overPagesLimits() : [], "the site exceeds Cloudflare Pages limits:");

        console.log(`${this.options.prod ? "production" : "dev"} build in ${relative(REPO_ROOT, this.out).replace(/\\/g, "/")}`);
        this.report(assets);
        const editorBundles = this.entries.filter(entry => roleOf(entry) === "editor").length;
        console.log(`guard OK: ${this.entries.length - editorBundles} game bundles free of "${EDITOR_MESSAGE_TYPE}", ${editorBundles} editor bundles carry it`
            + (this.options.withEditor ? "" : " (editor page and bundles skipped: --prod without --with-editor)"));
        return targetFeatureReport(this.options.target, checkBundleFeatures(this.featureChecks));
    }

    private siteRelative(path: string): string {
        return relative(this.out, path).replace(/\\/g, "/");
    }

    private bundlePath(entry: EntryPoint): string {
        return join(this.out, webBundleFile(entry.output));
    }

    private bundleTexts(): Map<EntryPoint, string> {
        return new Map(this.entries.map(entry => [entry, readFileSync(this.bundlePath(entry), "utf8")]));
    }

    private editorProtocolMisplaced(textByEntry: ReadonlyMap<EntryPoint, string>): string[] {
        return [...textByEntry].flatMap(([entry, text]) => {
            const carriesEditor = text.includes(EDITOR_MESSAGE_TYPE);
            const bundle = this.siteRelative(this.bundlePath(entry));
            if (roleOf(entry) === "editor") return carriesEditor ? [] : [`${bundle}: the editor bundle does not contain "${EDITOR_MESSAGE_TYPE}": the guard no longer matches the protocol`];
            return carriesEditor ? [`${bundle}: a game bundle contains "${EDITOR_MESSAGE_TYPE}", so it reaches the editor`] : [];
        });
    }

    private gzipPartSizesIfWorthIt(bytes: Uint8Array, target: string): number[] | undefined {
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

    private shouldGzip(file: AssetManifestFile): boolean {
        return this.options.prod && file.size >= MIN_GZIP_BYTES && !PRECOMPRESSED_EXTENSIONS.has(extname(file.path).toLowerCase());
    }

    private async writeProjectAssets(project: SiteProject): Promise<ProjectAssetManifest> {
        const built = buildProjectAssetManifest(REPO_ROOT, project.directory, nodePlatform(), await projectAssetRegistry(project.folder));
        const files = built.files.map((file): AssetManifestFile => {
            if (file.statOnly === true) return file;
            const target = join(this.out, file.path);
            mkdirSync(dirname(target), {recursive: true});
            if (this.shouldGzip(file)) {
                const gzipParts = this.gzipPartSizesIfWorthIt(readFileSync(join(REPO_ROOT, file.path)), target);
                if (gzipParts !== undefined) return {...file, gzipParts};
            }
            copyFileSync(join(REPO_ROOT, file.path), target);
            return file;
        });
        const manifest: ProjectAssetManifest = {prefabs: built.prefabs, files};
        const manifestPath = join(this.out, projectAssetManifestPath(project.directory));
        mkdirSync(dirname(manifestPath), {recursive: true});
        writeFileSync(manifestPath, JSON.stringify(manifest, null, this.options.prod ? undefined : DEV_MANIFEST_INDENT_SPACES));
        return manifest;
    }

    private writeDemoProjectDataFiles(): void {
        const projects = readdirSync(DEMO, {withFileTypes: true})
            .filter(entry => entry.isDirectory() && existsSync(join(DEMO, entry.name, PROJECT_MANIFEST_FILE)))
            .map(entry => join(DEMO, entry.name));
        for (const file of projects.flatMap(projectDataFilesUnder)) {
            const target = join(this.out, relative(REPO_ROOT, file));
            mkdirSync(dirname(target), {recursive: true});
            copyFileSync(file, target);
        }
    }

    private overPagesLimits(): string[] {
        const files = outputFiles(this.out);
        const oversized = files.filter(path => statSync(path).size > PAGES_MAX_FILE_BYTES)
            .map(path => `${this.siteRelative(path)}: ${formatSize(statSync(path).size)} exceeds the ${formatSize(PAGES_MAX_FILE_BYTES)} per-file limit`);
        return files.length > PAGES_MAX_FILES ? [...oversized, `${files.length} files exceed the ${PAGES_MAX_FILES}-file limit`] : oversized;
    }

    private sizeOf(path: string): number {
        return statSync(join(this.out, path)).size;
    }

    private transitGzippedSizeOf(path: string): number {
        if (!/\.(html|css|js|json)$/.test(path)) return this.sizeOf(path);
        return gzipSync(readFileSync(join(this.out, path)), {level: GZIP_LEVEL_HOST_TRANSIT}).length;
    }

    private pageResources(page: string): string[] {
        const html = readFileSync(join(this.out, page), "utf8");
        return [...html.matchAll(PAGE_RESOURCE_REFERENCE)].map(match => match[1]).filter(path => !EXTERNAL_REFERENCE.test(path) && existsSync(join(this.out, path)));
    }

    private firstLoads(): FirstLoad[] {
        return [
            {page: LANDING_PAGE, files: [LANDING_PAGE, ...this.pageResources(LANDING_PAGE)]},
            ...this.projects.flatMap(project => RENDER_BACKEND_KINDS.map((backend): FirstLoad => ({
                page: `${project.site.page}${BACKEND_QUERY}${backend}`,
                files: [
                    project.site.page,
                    ...this.pageResources(project.site.page),
                    webBundleFile(webPageBundle(project.slug, backend)),
                    webBundleFile(webWorkerBundle(project.slug, backend)),
                    projectAssetManifestPath(project.directory),
                ],
                projectDirectory: project.directory,
            }))),
        ];
    }

    private report(assets: readonly BuiltAssets[]): void {
        const site = outputFiles(this.out).map(path => this.siteRelative(path)).sort();
        for (const path of site.filter(path => !path.startsWith("demo/"))) {
            const gzipped = /\.(js|css|html)$/.test(path) ? `  (gzip ${(this.transitGzippedSizeOf(path) / KB).toFixed(1)} KiB)` : "";
            console.log(`${path}  ${(this.sizeOf(path) / KB).toFixed(1)} KiB${gzipped}`);
        }
        const projectData = site.filter(isProjectDataSitePath);
        console.log(`project data: ${projectData.length} files, ${formatSize(projectData.reduce((sum, path) => sum + this.sizeOf(path), 0))} (${projectData.join(", ")})`);

        const upFrontByDirectory = new Map(assets.map(({project, manifest}) => [project.directory, upFrontFiles(manifest)]));
        for (const {page, files: pageFiles, projectDirectory} of this.firstLoads()) {
            const files = [...pageFiles, ...projectData.filter(path => projectDirectory !== undefined && path.startsWith(projectDirectory + SITE_PATH_SEPARATOR))];
            const upFront = projectDirectory === undefined ? [] : upFrontByDirectory.get(projectDirectory) ?? [];
            const assetBytes = upFront.reduce((sum, file) => sum + transferBytes(file), 0);
            const onDisk = files.reduce((sum, path) => sum + this.sizeOf(path), 0) + assetBytes;
            const gzipped = files.reduce((sum, path) => sum + this.transitGzippedSizeOf(path), 0) + assetBytes;
            console.log(`first load ${page}: ${formatSize(onDisk)} (${formatSize(gzipped)} with text gzipped in transit)`
                + (assetBytes === 0 ? "" : `, of which ${upFront.length} asset files ${formatSize(assetBytes)}`));
        }
        for (const {project, manifest} of assets) {
            if (manifest.files.length === 0) continue;
            const onDemand = manifest.files.filter(file => file.lazy === true);
            const statOnly = manifest.files.filter(file => file.statOnly === true);
            const compressed = manifest.files.filter(file => file.gzipParts !== undefined);
            console.log(`${project.directory} assets: ${upFrontFiles(manifest).length} files fetched before the game starts, ${onDemand.length} when the game first loads them`
                + ` (${formatSize(onDemand.reduce((sum, file) => sum + transferBytes(file), 0))}), ${statOnly.length} listed for their size only`
                + (compressed.length === 0 ? "" : `; gzip-compressed: ${compressed.map(file => `${file.path} ${formatSize(file.size)} -> ${formatSize(transferBytes(file))} in ${file.gzipParts!.length} part(s)`).join(", ")}`));
            const byPath = new Map(manifest.files.map(file => [file.path, file]));
            for (const prefab of manifest.prefabs) {
                const lazy = prefab.files.map(path => byPath.get(path)!).filter(file => file.lazy === true);
                if (lazy.length > 0) console.log(`on-demand model ${prefab.name}: ${formatSize(lazy.reduce((sum, file) => sum + transferBytes(file), 0))} fetched when the game first loads it`);
            }
        }
        console.log(`site: ${site.length} files, ${formatSize(site.reduce((sum, path) => sum + this.sizeOf(path), 0))} total`);
    }

    private async buildEachEntrySeparately(): Promise<void> {
        for (const {source, output} of this.entries) {
            const config: MetafileBuildConfig = {
                entrypoints: [source],
                outdir: this.out,
                naming: `${output}.${OUTPUT_EXTENSION_PLACEHOLDER}`,
                target: "browser",
                sourcemap: "linked",
                minify: this.options.prod,
                metafile: true,
                throw: false,
                define: {[DEV_RELOAD_DEFINE]: JSON.stringify(!this.options.prod), ...featureDefines(this.options.target)},
            };
            const result: MetafileBuildOutput = await Bun.build(config);
            const bundle = webBundleFile(output);
            if (!result.success) throw new CliError(`bundling ${repoRelative(source)} failed:`, result.logs.map(String));
            this.featureChecks.push({...bundleInputsOf(source, requireMetafile(result, bundle)), name: bundle, target: this.options.target});
        }
    }
}

export function regenerateDemoSites(): void {
    for (const site of DEMO_SITES) reportGeneratedFiles(writeGeneratedFiles(demoSiteFolder(site)), "regenerate");
}

export async function buildWebSite(options: WebBuildOptions): Promise<TargetFeatureReport> {
    regenerateDemoSites();
    return await new WebSiteBuild(options).run();
}
