import {RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {
    DEFAULT_ENTRY_FILE,
    editorWorkerMainFile,
    GENERATED_SYSTEMS_EXPORT,
    GENERATED_SYSTEMS_FILE,
    generatedBackendPassesExport,
    generatedBackendSchemasExport,
    generatedBackendSchemasFile,
    generatedBackendSystemsExport,
    generatedBackendSystemsFile,
    projectSiteDirectory,
    projectSlug,
    START_PROJECT_EXPORT,
    TERMINAL_MAIN_FILE,
    WEB_PAGE_BOOTSTRAP_FILE,
    webBundleFile,
    webPageBundle,
    webPageMainFile,
    webWorkerBundle,
    webWorkerMainFile,
} from "../projectLayout";
import {generatedFileHeader} from "./generatedHeader";
import type {GeneratedSource, GeneratorOutput, ProjectGenerator} from "./generatedHeader";
import {GENERATED_INDENT, generatedText, importLines} from "./generatedModule";
import type {ModuleImport} from "./generatedModule";
import type {ProjectSources} from "./projectSources";

export const MAINS_GENERATOR_NAME = "mains";
export const MAINS_GENERATOR_VERSION = 3;
export const MAINS_GENERATED_HEADER = generatedFileHeader(MAINS_GENERATOR_NAME, MAINS_GENERATOR_VERSION);

interface ModuleExport {
    readonly path: readonly string[];
    readonly name: string;
}

interface BackendMain {
    readonly installer: ModuleExport;
    readonly editorPasses: ModuleExport;
    readonly display: ModuleExport;
    readonly presenterSetup: readonly string[];
    readonly installArguments: string;
    readonly setupImports: readonly ModuleExport[];
}

const TERMINAL_BACKEND: RenderBackendKind = "cells";
const PROJECT_DIRECTORY_CONSTANT = "PROJECT_DIRECTORY";
const TERMINAL_PROJECT_DIRECTORY = "`${__dirname}/..`";
const PRESENTER_FROM_PAGE = "presenter";

const BACKEND_MAINS: Readonly<Record<RenderBackendKind, BackendMain>> = {
    cells: {
        installer: {path: ["backends", "cells", "cellsBackend"], name: "installCellsBackend"},
        editorPasses: {path: ["backends", "cells", "cellsStandardPasses"], name: "CELLS_STANDARD_PASSES"},
        display: {path: ["hosts", "web", "cellCanvasDisplay"], name: "cellCanvasDisplayFromQuery"},
        presenterSetup: ["const presenter = page.cellPresenter();"],
        installArguments: PRESENTER_FROM_PAGE,
        setupImports: [],
    },
    pixels: {
        installer: {path: ["backends", "pixels", "pixelsBackend"], name: "installPixelsBackend"},
        editorPasses: {path: ["backends", "pixels", "pixelsStandardPasses"], name: "PIXELS_STANDARD_PASSES"},
        display: {path: ["hosts", "web", "pixelCanvasDisplay"], name: "pixelCanvasDisplayFromQuery"},
        presenterSetup: ["const presenter = page.pixelPresenter();"],
        installArguments: PRESENTER_FROM_PAGE,
        setupImports: [],
    },
    gpu: {
        installer: {path: ["backends", "gpu", "gpuBackend"], name: "installGpuBackend"},
        editorPasses: {path: ["backends", "gpu", "gpuStandardPasses"], name: "GPU_STANDARD_PASSES"},
        display: {path: ["hosts", "web", "gpuCanvasDisplay"], name: "gpuCanvasDisplayFromQuery"},
        presenterSetup: ["const device = await requestGpuDevice(page);", "const presenter = gpuCanvasPresenter(page, device);"],
        installArguments: `device, ${PRESENTER_FROM_PAGE}`,
        setupImports: [
            {path: ["hosts", "web", "gpuWorldDevice"], name: "requestGpuDevice"},
            {path: ["hosts", "web", "gpuWorldDevice"], name: "gpuCanvasPresenter"},
        ],
    },
};

class MainsWriter {
    private readonly slug: string;
    private readonly siteDirectory: string;
    private readonly gameName: string;
    private readonly entryModule: string;

    public constructor(private readonly sources: ProjectSources) {
        this.slug = projectSlug(sources.folder);
        this.siteDirectory = projectSiteDirectory(sources.folder);
        this.gameName = sources.manifest?.name ?? this.slug;
        this.entryModule = sources.projectModule(sources.manifest?.entry ?? DEFAULT_ENTRY_FILE);
    }

    public all(): GeneratedSource[] {
        return [
            this.terminalMain(),
            this.webPageBootstrap(),
            ...RENDER_BACKEND_KINDS.flatMap(kind => [this.webPageMain(kind), this.webWorkerMain(kind)]),
            ...RENDER_BACKEND_KINDS.map(kind => this.editorWorkerMain(kind)),
        ];
    }

    private source(file: string, imports: readonly ModuleImport[], body: readonly string[]): GeneratedSource {
        return {file, source: generatedText([MAINS_GENERATED_HEADER, ...importLines(this.sources, file, imports), "", ...body])};
    }

    private exported(module: ModuleExport): ModuleImport {
        return {names: [module.name], module: this.sources.sourceModule(...module.path)};
    }

    private startProjectImport(): ModuleImport {
        return {names: [START_PROJECT_EXPORT], module: this.entryModule};
    }

    private backendSystemsImport(kind: RenderBackendKind): ModuleImport {
        return {names: [generatedBackendSystemsExport(kind)], module: this.sources.projectModule(generatedBackendSystemsFile(kind))};
    }

    private backendHostImports(kind: RenderBackendKind): ModuleImport[] {
        return [
            {names: [generatedBackendSystemsExport(kind), generatedBackendPassesExport(kind)], module: this.sources.projectModule(generatedBackendSystemsFile(kind))},
            {names: [generatedBackendSchemasExport(kind)], module: this.sources.projectModule(generatedBackendSchemasFile(kind))},
        ];
    }

    private backendHostOptions(kind: RenderBackendKind): string {
        return `backendSystems: ${generatedBackendSystemsExport(kind)}, hostSchemas: ${generatedBackendSchemasExport(kind)}`;
    }

    private terminalMain(): GeneratedSource {
        const backend = BACKEND_MAINS[TERMINAL_BACKEND];
        return this.source(TERMINAL_MAIN_FILE, [
            this.exported(backend.installer),
            {names: ["runTerminalGame"], module: this.sources.sourceModule("hosts", "terminal", "terminalGame")},
            this.startProjectImport(),
            ...this.backendHostImports(TERMINAL_BACKEND),
        ], [
            `const ${PROJECT_DIRECTORY_CONSTANT} = ${TERMINAL_PROJECT_DIRECTORY};`,
            "",
            `runTerminalGame(${JSON.stringify(this.gameName)}, async (world, presenter) => {`,
            `${GENERATED_INDENT}${backend.installer.name}(world, presenter, ${generatedBackendPassesExport(TERMINAL_BACKEND)});`,
            `${GENERATED_INDENT}await ${START_PROJECT_EXPORT}(world, {directory: ${PROJECT_DIRECTORY_CONSTANT}, ${this.backendHostOptions(TERMINAL_BACKEND)}});`,
            "});",
        ]);
    }

    private webPageBootstrap(): GeneratedSource {
        const scripts = RENDER_BACKEND_KINDS.map(kind => `${kind}: ${JSON.stringify(webBundleFile(webPageBundle(this.slug, kind)))}`).join(", ");
        return this.source(WEB_PAGE_BOOTSTRAP_FILE, [
            {names: ["connectDevReload"], module: this.sources.sourceModule("hosts", "web", "devReload")},
            {names: ["loadRenderBackendScript", "pageDefaultRenderBackend"], module: this.sources.sourceModule("hosts", "web", "renderBackendBootstrap")},
        ], [
            `loadRenderBackendScript({${scripts}}, {defaultBackend: pageDefaultRenderBackend(document)});`,
            "connectDevReload();",
        ]);
    }

    private webPageMain(kind: RenderBackendKind): GeneratedSource {
        const display = BACKEND_MAINS[kind].display;
        const worker = JSON.stringify(webBundleFile(webWorkerBundle(this.slug, kind)));
        return this.source(webPageMainFile(kind), [
            this.exported(display),
            {names: ["startWorldPage"], module: this.sources.sourceModule("hosts", "web", "worldPage")},
        ], [
            `startWorldPage(${worker}, ${JSON.stringify(this.gameName)}, ${display.name});`,
        ]);
    }

    private webWorkerMain(kind: RenderBackendKind): GeneratedSource {
        const backend = BACKEND_MAINS[kind];
        return this.source(webWorkerMainFile(kind), [
            {names: ["App"], module: this.sources.engineModule("core")},
            this.exported(backend.installer),
            ...backend.setupImports.map(module => this.exported(module)),
            {names: ["runProjectInWorker"], module: this.sources.sourceModule("hosts", "web", "projectWorker")},
            {names: ["runWorldWorker"], module: this.sources.sourceModule("hosts", "web", "worldWorker")},
            this.startProjectImport(),
            ...this.backendHostImports(kind),
        ], [
            `const ${PROJECT_DIRECTORY_CONSTANT} = ${JSON.stringify(this.siteDirectory)};`,
            "",
            "runWorldWorker(async (page, files) => {",
            ...backend.presenterSetup.map(line => GENERATED_INDENT + line),
            `${GENERATED_INDENT}const world = new App({platform: page.platform}).createDebugWorld();`,
            `${GENERATED_INDENT}${backend.installer.name}(world, ${backend.installArguments}, ${generatedBackendPassesExport(kind)});`,
            `${GENERATED_INDENT}await runProjectInWorker(world, page, files, {directory: ${PROJECT_DIRECTORY_CONSTANT}, ${START_PROJECT_EXPORT}, ${this.backendHostOptions(kind)}});`,
            "});",
        ]);
    }

    private editorWorkerMain(kind: RenderBackendKind): GeneratedSource {
        const backend = BACKEND_MAINS[kind];
        return this.source(editorWorkerMainFile(kind), [
            this.exported(backend.installer),
            this.exported(backend.editorPasses),
            ...backend.setupImports.map(module => this.exported(module)),
            {names: ["runProjectEditorWorker"], module: this.sources.sourceModule("editor", "launch", "projectEditorWorker")},
            this.startProjectImport(),
            {names: [GENERATED_SYSTEMS_EXPORT], module: this.sources.projectModule(GENERATED_SYSTEMS_FILE)},
            this.backendSystemsImport(kind),
        ], [
            `runProjectEditorWorker(${START_PROJECT_EXPORT}, {shared: ${GENERATED_SYSTEMS_EXPORT}, backend: ${generatedBackendSystemsExport(kind)}}, async (world, page) => {`,
            ...backend.presenterSetup.map(line => GENERATED_INDENT + line),
            `${GENERATED_INDENT}${backend.installer.name}(world, ${backend.installArguments}, ${backend.editorPasses.name});`,
            "});",
        ]);
    }
}

function mainsOf(sources: ProjectSources): GeneratorOutput {
    return {sources: new MainsWriter(sources).all(), warnings: []};
}

export const MAINS_GENERATOR: ProjectGenerator = {
    name: MAINS_GENERATOR_NAME,
    version: MAINS_GENERATOR_VERSION,
    files: [
        TERMINAL_MAIN_FILE,
        WEB_PAGE_BOOTSTRAP_FILE,
        ...RENDER_BACKEND_KINDS.flatMap(kind => [webPageMainFile(kind), webWorkerMainFile(kind)]),
        ...RENDER_BACKEND_KINDS.map(editorWorkerMainFile),
    ],
    generate: mainsOf,
};
