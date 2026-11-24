import {targetSettingsOf} from "../../engine/project/projectTargets";
import type {ProjectTarget, ProjectTargetSettings} from "../../engine/project/projectTargets";
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
    projectSlug,
    START_PROJECT_EXPORT,
    TERMINAL_MAIN_FILE,
    WEB_PAGE_BOOTSTRAP_FILE,
    WEB_PROJECT_DIRECTORY,
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
export const MAINS_GENERATOR_VERSION = 6;
export const MAINS_GENERATED_HEADER = generatedFileHeader(MAINS_GENERATOR_NAME, MAINS_GENERATOR_VERSION);

interface ModuleExport {
    readonly entryPoint: string;
    readonly name: string;
}

interface BackendMain {
    readonly installer: ModuleExport;
    readonly editorPasses: ModuleExport;
    readonly display: ModuleExport;
    readonly scaledDisplay?: ModuleExport;
    readonly presenterSetup: readonly string[];
    readonly installArguments: string;
    readonly setupImports: readonly ModuleExport[];
    readonly editorCanvasPresenter?: ModuleExport;
}

const TERMINAL_BACKEND: RenderBackendKind = "cells";
const PROJECT_DIRECTORY_CONSTANT = "PROJECT_DIRECTORY";
const TERMINAL_PROJECT_DIRECTORY = "`${__dirname}/..`";
const PRESENTER_FROM_PAGE = "presenter";
const WEB_TARGET: ProjectTarget = "web";
const PAGE_DEFAULT_BACKEND_FUNCTION = "pageDefaultRenderBackend";
const ENGINE_CORE_ENTRY_POINT = "engine/core";
const TERMINAL_HOST_ENTRY_POINT = "hosts/terminal";
const WEB_PAGE_ENTRY_POINT = "hosts/web";
const WEB_BOOTSTRAP_ENTRY_POINT = "hosts/web/bootstrap";
const WEB_WORKER_ENTRY_POINT = "hosts/web/worker";
const EDITOR_LAUNCH_ENTRY_POINT = "editor/launch";

const BACKEND_MAINS: Readonly<Record<RenderBackendKind, BackendMain>> = {
    cells: {
        installer: {entryPoint: "backends/cells", name: "installCellsBackend"},
        editorPasses: {entryPoint: "backends/cells", name: "CELLS_STANDARD_PASSES"},
        display: {entryPoint: "hosts/web/cells", name: "cellCanvasDisplayFromQuery"},
        presenterSetup: ["const presenter = page.cellPresenter();"],
        installArguments: PRESENTER_FROM_PAGE,
        setupImports: [],
    },
    pixels: {
        installer: {entryPoint: "backends/pixels", name: "installPixelsBackend"},
        editorPasses: {entryPoint: "backends/pixels", name: "PIXELS_STANDARD_PASSES"},
        display: {entryPoint: "hosts/web/pixels", name: "pixelCanvasDisplayFromQuery"},
        scaledDisplay: {entryPoint: "hosts/web/pixels", name: "pixelCanvasDisplayScaledBy"},
        presenterSetup: ["const presenter = page.pixelPresenter();"],
        installArguments: PRESENTER_FROM_PAGE,
        setupImports: [],
    },
    gpu: {
        installer: {entryPoint: "backends/gpu", name: "installGpuBackend"},
        editorPasses: {entryPoint: "backends/gpu", name: "GPU_STANDARD_PASSES"},
        display: {entryPoint: "hosts/web/gpu", name: "gpuCanvasDisplayFromQuery"},
        scaledDisplay: {entryPoint: "hosts/web/gpu", name: "gpuCanvasDisplayScaledBy"},
        presenterSetup: ["const device = await requestGpuDevice(page);", "const presenter = gpuCanvasPresenter(page, device);"],
        installArguments: `device, ${PRESENTER_FROM_PAGE}`,
        setupImports: [
            {entryPoint: "hosts/web/worker/gpu", name: "requestGpuDevice"},
            {entryPoint: "hosts/web/worker/gpu", name: "gpuCanvasPresenter"},
        ],
        editorCanvasPresenter: {entryPoint: "backends/gpu", name: "gpuCanvasPresenterFactory"},
    },
};
const GPU_DEVICE_VARIABLE = "device";

class MainsWriter {
    private readonly slug: string;
    private readonly gameName: string;
    private readonly entryModule: string;
    private readonly webSettings: ProjectTargetSettings;

    public constructor(private readonly sources: ProjectSources) {
        this.slug = projectSlug(sources.folder);
        this.gameName = sources.manifest?.name ?? this.slug;
        this.entryModule = sources.projectModule(sources.manifest?.entry ?? DEFAULT_ENTRY_FILE);
        this.webSettings = targetSettingsOf(sources.manifest?.targets, WEB_TARGET);
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
        return {names: [module.name], module: this.sources.entryPointModule(module.entryPoint)};
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
            {names: ["runTerminalGame"], module: this.sources.entryPointModule(TERMINAL_HOST_ENTRY_POINT)},
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
        const projectBackend = this.webSettings.backend;
        const bootstrapNames = projectBackend === undefined ? ["loadRenderBackendScript", PAGE_DEFAULT_BACKEND_FUNCTION] : ["loadRenderBackendScript"];
        const defaultBackend = projectBackend === undefined ? `${PAGE_DEFAULT_BACKEND_FUNCTION}(document)` : JSON.stringify(projectBackend);
        return this.source(WEB_PAGE_BOOTSTRAP_FILE, [
            {names: ["connectDevReload", ...bootstrapNames], module: this.sources.entryPointModule(WEB_BOOTSTRAP_ENTRY_POINT)},
        ], [
            `loadRenderBackendScript({${scripts}}, {defaultBackend: ${defaultBackend}});`,
            "connectDevReload();",
        ]);
    }

    private webPageDisplay(kind: RenderBackendKind): {readonly module: ModuleExport, readonly expression: string} {
        const backend = BACKEND_MAINS[kind];
        const pixelScale = this.webSettings.pixelScale;
        const scaled = backend.scaledDisplay;
        if (pixelScale === undefined || scaled === undefined) return {module: backend.display, expression: backend.display.name};
        return {module: scaled, expression: `${scaled.name}(${pixelScale})`};
    }

    private webPageMain(kind: RenderBackendKind): GeneratedSource {
        const display = this.webPageDisplay(kind);
        const worker = JSON.stringify(webBundleFile(webWorkerBundle(this.slug, kind)));
        return this.source(webPageMainFile(kind), [
            this.exported(display.module),
            {names: ["startWorldPage"], module: this.sources.entryPointModule(WEB_PAGE_ENTRY_POINT)},
        ], [
            `startWorldPage(${worker}, ${JSON.stringify(this.gameName)}, ${display.expression});`,
        ]);
    }

    private webWorkerMain(kind: RenderBackendKind): GeneratedSource {
        const backend = BACKEND_MAINS[kind];
        return this.source(webWorkerMainFile(kind), [
            {names: ["App"], module: this.sources.entryPointModule(ENGINE_CORE_ENTRY_POINT)},
            this.exported(backend.installer),
            ...backend.setupImports.map(module => this.exported(module)),
            {names: ["runProjectInWorker", "runWorldWorker"], module: this.sources.entryPointModule(WEB_WORKER_ENTRY_POINT)},
            this.startProjectImport(),
            ...this.backendHostImports(kind),
        ], [
            `const ${PROJECT_DIRECTORY_CONSTANT} = ${JSON.stringify(WEB_PROJECT_DIRECTORY)};`,
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
        const canvasPresenter = backend.editorCanvasPresenter;
        return this.source(editorWorkerMainFile(kind), [
            ...(canvasPresenter === undefined ? [] : [this.exported(canvasPresenter)]),
            this.exported(backend.installer),
            this.exported(backend.editorPasses),
            ...backend.setupImports.map(module => this.exported(module)),
            {names: ["runProjectEditorWorker"], module: this.sources.entryPointModule(EDITOR_LAUNCH_ENTRY_POINT)},
            this.startProjectImport(),
            {names: [GENERATED_SYSTEMS_EXPORT], module: this.sources.projectModule(GENERATED_SYSTEMS_FILE)},
            this.backendSystemsImport(kind),
        ], [
            `runProjectEditorWorker(${START_PROJECT_EXPORT}, {shared: ${GENERATED_SYSTEMS_EXPORT}, backend: ${generatedBackendSystemsExport(kind)}}, async (world, page) => {`,
            ...backend.presenterSetup.map(line => GENERATED_INDENT + line),
            `${GENERATED_INDENT}${backend.installer.name}(world, ${backend.installArguments}, ${backend.editorPasses.name});`,
            ...(canvasPresenter === undefined ? [] : [`${GENERATED_INDENT}return {canvasPresenter: ${canvasPresenter.name}(${GPU_DEVICE_VARIABLE})};`]),
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
