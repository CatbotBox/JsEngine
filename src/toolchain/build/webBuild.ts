import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from "fs";
import {dirname, extname, join, posix, relative, resolve} from "path";
import {gzipSync} from "zlib";
import {nodePlatform} from "../../hosts/terminal";
import {QUERY_OR_FRAGMENT} from "../../hosts/desktop";
import {RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {targetSettingsOf} from "../../engine/project/projectTargets";
import type {ProjectTarget} from "../../engine/project/projectTargets";
import {EDITOR_MESSAGE_TYPE} from "../../editor/editorProtocol";
import {DEV_RELOAD_DEFINE} from "../../hosts/web/devReload";
import {projectAssetManifestPath} from "../../hosts/web/webProjectAssets";
import type {AssetManifestFile, ProjectAssetManifest} from "../../hosts/web/webProjectAssets";
import {CliError} from "../cliArguments";
import {writeGeneratedFiles} from "../generate/generatedFiles";
import {isInside} from "../generate/projectSources";
import {displayPath, readProjectManifest} from "../project";
import {
    PROJECT_WEB_PAGE_FILE,
    projectSlug,
    WEB_PAGE_BOOTSTRAP_FILE,
    WEB_PROJECT_DIRECTORY,
    webBundleFile,
    webPageBootstrapBundle,
    webPageBundle,
    webPageMainFile,
    webWorkerBundle,
    webWorkerMainFile,
} from "../projectLayout";
import {sampleProjectFolders} from "../projectSites";
import {repoRelative, slashed, SOURCE_ROOT, webDistOf} from "../repoPaths";
import {featureDefines} from "../targets";
import type {HostTarget} from "../targets";
import {isWebProjectDataFile} from "./webDistFiles";
import {buildProjectAssetManifest, projectAssetRegistry} from "./projectAssets";
import {reportGeneratedFiles} from "../generate/generatedFilesReport";
import {bundleInputsOf, requireMetafile} from "./bundleMetafile";
import type {MetafileBuildConfig, MetafileBuildOutput} from "./bundleMetafile";
import {ENGINE_IMPORTS} from "./editorBuild";
import {checkBundleFeatures, targetFeatureReport} from "./featureDetection";
import type {FeatureCheckBundle, TargetFeatureReport} from "./featureDetection";
import {projectPageHtml} from "./projectPage";

export interface WebBuildOptions {
    readonly prod: boolean;
    readonly withEditor: boolean;
    readonly target: HostTarget;
    readonly project?: string;
}

const WEB = join(SOURCE_ROOT, "hosts", "web");
const EDITOR_LAUNCH = join(SOURCE_ROOT, "editor", "launch");

type BundleRole = "game" | "editor";

interface EntryPoint {
    readonly source: string;
    readonly output: string;
    readonly siteFolder: string;
    readonly backend?: RenderBackendKind;
    readonly role?: BundleRole;
}

interface SiteProject {
    readonly folder: string;
    readonly slug: string;
}

interface WrittenAssets {
    readonly manifest: ProjectAssetManifest;
    readonly files: readonly string[];
}

interface BuiltProject {
    readonly project: SiteProject;
    readonly manifest: ProjectAssetManifest;
    readonly dataFiles: readonly string[];
    readonly assetFiles: readonly string[];
}

interface FirstLoad {
    readonly page: string;
    readonly files: readonly string[];
    readonly upFront: readonly AssetManifestFile[];
}

const SITE_ROOT = "";
const SITE_PATH_SEPARATOR = "/";
const SITE_PAGE = "index.html";
const LANDING_PAGE = "index.html";
const ISOLATION_SCRIPT = "coi-serviceworker.js";
const PAGE_STYLESHEET = "demo.css";
const HOST_HEADERS_FILE = "_headers";
const ROOT_STATIC_FILES: readonly string[] = [HOST_HEADERS_FILE];
const SHOWCASE_STATIC_FILES: readonly string[] = [LANDING_PAGE, ISOLATION_SCRIPT];
const PROJECT_STATIC_FILES: readonly string[] = [PAGE_STYLESHEET, ISOLATION_SCRIPT];
const EDITOR_STATIC_FILES: readonly string[] = ["editor.html", "editor.css", "editorStart.css"];
const EDITOR_ENTRY: EntryPoint = {source: join(EDITOR_LAUNCH, "editor.ts"), output: "editor", siteFolder: SITE_ROOT, backend: "pixels", role: "editor"};
const DEFAULT_BUNDLE_ROLE: BundleRole = "game";
const WEB_TARGET: ProjectTarget = "web";
const OUTPUT_EXTENSION_PLACEHOLDER = "[ext]";
const GITHUB_PAGES_NO_JEKYLL = ".nojekyll";
const PAGE_RESOURCE_REFERENCE = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g;
const EXTERNAL_REFERENCE = /^[a-z]+:|^\/\//i;
const GZIP_PART_SUFFIX = ".gz.part";

const KB = 1024;
const MB = 1024 * 1024;
const DEV_MANIFEST_INDENT_SPACES = 1;

const PROJECT_FOLDERS_LEFT_OUT: ReadonlySet<string> = new Set([".jsengine", "node_modules"]);
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

function formatSize(bytes: number): string {
    return bytes < MB ? `${(bytes / KB).toFixed(1)} KiB` : `${(bytes / MB).toFixed(2)} MB`;
}

function guard(problems: readonly string[], message: string): void {
    if (problems.length > 0) throw new CliError(message, problems);
}

function gzipPartPath(target: string, part: number): string {
    return `${target}${GZIP_PART_SUFFIX}${part}`;
}

function copyInto(fromDirectory: string, names: readonly string[], toDirectory: string): void {
    mkdirSync(toDirectory, {recursive: true});
    for (const name of names) copyFileSync(join(fromDirectory, name), join(toDirectory, name));
}

function sitePathOf(reference: string, pageFolder: string): string {
    const [path] = reference.split(QUERY_OR_FRAGMENT, 1);
    return path.startsWith(SITE_PATH_SEPARATOR) ? posix.normalize(path.slice(SITE_PATH_SEPARATOR.length)) : posix.join(pageFolder, path);
}

function projectEntries(project: SiteProject): EntryPoint[] {
    const siteFolder = project.slug;
    return [
        {source: join(project.folder, WEB_PAGE_BOOTSTRAP_FILE), output: webPageBootstrapBundle(project.slug), siteFolder},
        ...RENDER_BACKEND_KINDS.flatMap((backend): EntryPoint[] => [
            {source: join(project.folder, webPageMainFile(backend)), output: webPageBundle(project.slug, backend), siteFolder, backend},
            {source: join(project.folder, webWorkerMainFile(backend)), output: webWorkerBundle(project.slug, backend), siteFolder, backend},
        ]),
    ];
}

function siteProjectsOf(folders: readonly string[]): SiteProject[] {
    const projects = folders.map((folder): SiteProject => ({folder, slug: projectSlug(folder)}));
    const sharing = projects.filter((project, index) => projects.findIndex(other => other.slug === project.slug) !== index);
    guard(sharing.map(project => `${displayPath(project.folder)} would build into ${project.slug}${SITE_PATH_SEPARATOR} like an earlier project; rename its folder`),
        "two projects share a site folder:");
    return projects;
}

class WebSiteBuild {
    private readonly out: string;
    private readonly entries: readonly EntryPoint[];
    private readonly featureChecks: FeatureCheckBundle[] = [];

    public constructor(private readonly options: WebBuildOptions, private readonly projects: readonly SiteProject[], private readonly showcase: boolean) {
        this.out = webDistOf(options.prod);
        this.entries = [...projects.flatMap(projectEntries), ...(options.withEditor ? [EDITOR_ENTRY] : [])];
    }

    public async run(): Promise<TargetFeatureReport> {
        rmSync(this.out, {recursive: true, force: true});
        mkdirSync(this.out, {recursive: true});

        await this.buildEachEntrySeparately();
        this.writeRootFiles();
        const built: BuiltProject[] = [];
        for (const project of this.projects) built.push(await this.writeProject(project));

        guard(this.editorProtocolMisplaced(this.bundleTexts()), "the editor protocol is in the wrong bundles:");
        guard(this.options.prod ? this.overPagesLimits() : [], "the site exceeds Cloudflare Pages limits:");

        const folders = this.projects.map(project => project.slug + SITE_PATH_SEPARATOR).join(", ");
        console.log(`${this.options.prod ? "production" : "dev"} build of ${folders}${this.showcase ? " and the landing page" : ""} in ${repoRelative(this.out)}`);
        this.report(built);
        const editorBundles = this.entries.filter(entry => roleOf(entry) === "editor").length;
        console.log(`guard OK: ${this.entries.length - editorBundles} game bundles free of "${EDITOR_MESSAGE_TYPE}", ${editorBundles} editor bundles carry it`
            + (this.options.withEditor ? "" : " (editor page and bundles skipped: --prod without --with-editor)"));
        return targetFeatureReport(this.options.target, checkBundleFeatures(this.featureChecks));
    }

    private siteRelative(path: string): string {
        return slashed(relative(this.out, path));
    }

    private bundlePath(entry: EntryPoint): string {
        return join(this.out, entry.siteFolder, webBundleFile(entry.output));
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

    private writeRootFiles(): void {
        copyInto(WEB, ROOT_STATIC_FILES, this.out);
        if (this.showcase) copyInto(WEB, SHOWCASE_STATIC_FILES, this.out);
        if (this.options.withEditor) copyInto(EDITOR_LAUNCH, EDITOR_STATIC_FILES, this.out);
        writeFileSync(join(this.out, GITHUB_PAGES_NO_JEKYLL), "");
    }

    private async writeProject(project: SiteProject): Promise<BuiltProject> {
        copyInto(WEB, PROJECT_STATIC_FILES, join(this.out, project.slug));
        this.writeProjectPage(project);
        const assets = await this.writeProjectAssets(project);
        return {project, manifest: assets.manifest, dataFiles: this.writeProjectDataFiles(project), assetFiles: assets.files};
    }

    private writeProjectPage(project: SiteProject): void {
        const handWritten = join(project.folder, PROJECT_WEB_PAGE_FILE);
        const page = posix.join(project.slug, SITE_PAGE);
        const bootstrap = webBundleFile(webPageBootstrapBundle(project.slug));
        if (existsSync(handWritten)) {
            copyFileSync(handWritten, join(this.out, page));
        } else {
            const manifest = readProjectManifest(project.folder);
            writeFileSync(join(this.out, page), projectPageHtml({
                title: manifest.name,
                defaultBackend: targetSettingsOf(manifest.targets, WEB_TARGET).backend,
                script: bootstrap,
                stylesheet: PAGE_STYLESHEET,
                isolationScript: ISOLATION_SCRIPT,
            }));
        }
        if (!this.pageReferences(page).includes(posix.join(project.slug, bootstrap))) {
            throw new CliError(`${displayPath(handWritten)} does not load ${bootstrap}, the script that starts the game; add <script type="module" src="${bootstrap}"></script>`);
        }
    }

    private projectFileTarget(project: SiteProject, path: string, source: string): string {
        const directory = join(this.out, project.slug);
        const target = join(directory, path);
        if (!isInside(directory, target)) throw new CliError(`${displayPath(source)} is outside ${displayPath(project.folder)}; a web build ships only files inside the project folder`);
        if (existsSync(target)) throw new CliError(`${displayPath(source)} would overwrite ${this.siteRelative(target)}, which the web build writes itself; rename it`);
        mkdirSync(dirname(target), {recursive: true});
        return target;
    }

    private gzipPartSizesIfWorthIt(bytes: Uint8Array, target: string): number[] | undefined {
        const compressed = gzipSync(bytes, {level: GZIP_LEVEL_MAX});
        if (compressed.length > bytes.length * (1 - MIN_GZIP_SAVING_FRACTION)) return undefined;
        const parts: number[] = [];
        for (let offset = 0; offset < compressed.length; offset += GZIP_PART_BYTES) {
            const part = compressed.subarray(offset, offset + GZIP_PART_BYTES);
            writeFileSync(gzipPartPath(target, parts.length), part);
            parts.push(part.length);
        }
        return parts;
    }

    private shouldGzip(file: AssetManifestFile): boolean {
        return this.options.prod && file.size >= MIN_GZIP_BYTES && !PRECOMPRESSED_EXTENSIONS.has(extname(file.path).toLowerCase());
    }

    private async writeProjectAssets(project: SiteProject): Promise<WrittenAssets> {
        const built = buildProjectAssetManifest(project.folder, WEB_PROJECT_DIRECTORY, nodePlatform(), await projectAssetRegistry(project.folder));
        const written: string[] = [];
        const files = built.files.map((file): AssetManifestFile => {
            if (file.statOnly === true) return file;
            const source = join(project.folder, file.path);
            const target = this.projectFileTarget(project, file.path, source);
            if (this.shouldGzip(file)) {
                const gzipParts = this.gzipPartSizesIfWorthIt(readFileSync(source), target);
                if (gzipParts !== undefined) {
                    written.push(...gzipParts.map((_, part) => this.siteRelative(gzipPartPath(target, part))));
                    return {...file, gzipParts};
                }
            }
            copyFileSync(source, target);
            written.push(this.siteRelative(target));
            return file;
        });
        const manifest: ProjectAssetManifest = {prefabs: built.prefabs, files};
        const manifestPath = join(this.out, project.slug, projectAssetManifestPath(WEB_PROJECT_DIRECTORY));
        writeFileSync(manifestPath, JSON.stringify(manifest, null, this.options.prod ? undefined : DEV_MANIFEST_INDENT_SPACES));
        return {manifest, files: written};
    }

    private writeProjectDataFiles(project: SiteProject): string[] {
        return projectDataFilesUnder(project.folder).map(source => {
            const target = this.projectFileTarget(project, relative(project.folder, source), source);
            copyFileSync(source, target);
            return this.siteRelative(target);
        });
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

    private pageReferences(page: string): string[] {
        const html = readFileSync(join(this.out, page), "utf8");
        return [...html.matchAll(PAGE_RESOURCE_REFERENCE)].map(match => match[1]).filter(path => !EXTERNAL_REFERENCE.test(path))
            .map(reference => sitePathOf(reference, posix.dirname(page)));
    }

    private pageResources(page: string): string[] {
        return this.pageReferences(page).filter(path => existsSync(join(this.out, path)));
    }

    private firstLoads(built: readonly BuiltProject[]): FirstLoad[] {
        const landing: FirstLoad[] = this.showcase ? [{page: LANDING_PAGE, files: [LANDING_PAGE, ...this.pageResources(LANDING_PAGE)], upFront: []}] : [];
        return [
            ...landing,
            ...built.flatMap(({project, manifest, dataFiles}) => {
                const page = posix.join(project.slug, SITE_PAGE);
                return RENDER_BACKEND_KINDS.map((backend): FirstLoad => ({
                    page: `${project.slug}${SITE_PATH_SEPARATOR}${BACKEND_QUERY}${backend}`,
                    files: [
                        page,
                        ...this.pageResources(page),
                        posix.join(project.slug, webBundleFile(webPageBundle(project.slug, backend))),
                        posix.join(project.slug, webBundleFile(webWorkerBundle(project.slug, backend))),
                        posix.join(project.slug, projectAssetManifestPath(WEB_PROJECT_DIRECTORY)),
                        ...dataFiles,
                    ],
                    upFront: upFrontFiles(manifest),
                }));
            }),
        ];
    }

    private report(built: readonly BuiltProject[]): void {
        const site = outputFiles(this.out).map(path => this.siteRelative(path)).sort();
        const projectFiles = new Set(built.flatMap(project => [...project.dataFiles, ...project.assetFiles]));
        for (const path of site.filter(path => !projectFiles.has(path))) {
            const gzipped = /\.(js|css|html)$/.test(path) ? `  (gzip ${(this.transitGzippedSizeOf(path) / KB).toFixed(1)} KiB)` : "";
            console.log(`${path}  ${(this.sizeOf(path) / KB).toFixed(1)} KiB${gzipped}`);
        }
        for (const {project, dataFiles} of built) {
            console.log(`${project.slug} project data: ${dataFiles.length} files, ${formatSize(dataFiles.reduce((sum, path) => sum + this.sizeOf(path), 0))} (${dataFiles.join(", ")})`);
        }

        for (const {page, files, upFront} of this.firstLoads(built)) {
            const assetBytes = upFront.reduce((sum, file) => sum + transferBytes(file), 0);
            const onDisk = files.reduce((sum, path) => sum + this.sizeOf(path), 0) + assetBytes;
            const gzipped = files.reduce((sum, path) => sum + this.transitGzippedSizeOf(path), 0) + assetBytes;
            console.log(`first load ${page}: ${formatSize(onDisk)} (${formatSize(gzipped)} with text gzipped in transit)`
                + (assetBytes === 0 ? "" : `, of which ${upFront.length} asset files ${formatSize(assetBytes)}`));
        }
        for (const {project, manifest} of built) {
            if (manifest.files.length === 0) continue;
            const onDemand = manifest.files.filter(file => file.lazy === true);
            const statOnly = manifest.files.filter(file => file.statOnly === true);
            const compressed = manifest.files.filter(file => file.gzipParts !== undefined);
            console.log(`${project.slug} assets: ${upFrontFiles(manifest).length} files fetched before the game starts, ${onDemand.length} when the game first loads them`
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
        for (const entry of this.entries) {
            const config: MetafileBuildConfig = {
                entrypoints: [entry.source],
                outdir: join(this.out, entry.siteFolder),
                naming: `${entry.output}.${OUTPUT_EXTENSION_PLACEHOLDER}`,
                target: "browser",
                sourcemap: "linked",
                minify: this.options.prod,
                metafile: true,
                throw: false,
                define: {[DEV_RELOAD_DEFINE]: JSON.stringify(!this.options.prod), ...featureDefines(this.options.target)},
                plugins: [ENGINE_IMPORTS],
            };
            const result: MetafileBuildOutput = await Bun.build(config);
            const bundle = this.siteRelative(this.bundlePath(entry));
            if (!result.success) throw new CliError(`bundling ${repoRelative(entry.source)} failed:`, result.logs.map(String));
            this.featureChecks.push({...bundleInputsOf(entry.source, requireMetafile(result, bundle)), name: bundle, target: this.options.target});
        }
    }
}

function regenerate(folders: readonly string[]): void {
    for (const folder of folders) reportGeneratedFiles(writeGeneratedFiles(folder), "regenerate");
}

export function regenerateSampleProjects(): void {
    regenerate(sampleProjectFolders());
}

export async function buildWebSite(options: WebBuildOptions): Promise<TargetFeatureReport> {
    const folders = options.project === undefined ? sampleProjectFolders() : [resolve(options.project)];
    regenerate(folders);
    return await new WebSiteBuild(options, siteProjectsOf(folders), options.project === undefined).run();
}
