import {PROJECT_MANIFEST_FILE, SYSTEMS_MANIFEST_KEY} from "../../engine/project/projectManifest";
import {isRenderBackendKind, RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {
    BACKEND_FOLDER,
    GENERATED_SYSTEMS_EXPORT,
    GENERATED_SYSTEMS_FILE,
    generatedBackendSystemsExport,
    generatedBackendSystemsFile,
} from "../projectLayout";
import {generatedFileHeader} from "./generatedHeader";
import type {GeneratedSource, GeneratorOutput, ProjectGenerator} from "./generatedHeader";
import {ImportTable} from "./generatedImports";
import {compareText, ProjectSources, SOURCE_EXTENSION_PATTERN} from "./projectSources";
import type {ExportedClass} from "./projectSources";

export const SYSTEMS_GENERATOR_NAME = "systems";
export const SYSTEMS_GENERATOR_VERSION = 1;
export const SYSTEMS_GENERATED_HEADER = generatedFileHeader(SYSTEMS_GENERATOR_NAME, SYSTEMS_GENERATOR_VERSION);
export const UNMATCHED_SYSTEM_EXCLUDE_WARNING = "matches no system";
export const SYSTEM_CONSTRUCTOR_ARGUMENTS_WARNING = "takes constructor arguments, so the system list cannot create it";
export const OUTSIDE_BACKEND_FOLDERS_WARNING = "is outside the render backend folders, so its systems are left out";

const LINE_BREAK = "\r\n";
const INDENT = "    ";
const PATH_SEPARATOR = "/";
const ENGINE_CORE_MODULE = "core";
const ENGINE_SYSTEM_CLASS = "System";
const SYSTEM_TYPE = "System";
const SYSTEM_CTOR_TYPE = "SystemCtor";
const NO_EXCLUDED_NAMES: readonly string[] = [];
const BACKEND_KIND_SEGMENT = 1;
const FIRST_FILE_IN_KIND_FOLDER_SEGMENTS = 3;

export interface GenerateProjectSystemsOptions {
    readonly repoRoot: string;
    readonly exclude?: readonly string[];
}

interface DiscoveredSystem {
    readonly exported: ExportedClass;
    readonly backend: RenderBackendKind | undefined;
}

interface SystemList {
    readonly file: string;
    readonly exportName: string;
    readonly systems: readonly DiscoveredSystem[];
}

function bySourceOrder(a: DiscoveredSystem, b: DiscoveredSystem): number {
    return compareText(a.exported.relativeFile, b.exported.relativeFile) || compareText(a.exported.className, b.exported.className);
}

class SystemsGenerator {
    private readonly warnings: string[] = [];
    private readonly reportedBackendPlaces = new Set<string>();

    public constructor(private readonly sources: ProjectSources) {
    }

    public generate(exclude: readonly string[]): GeneratorOutput {
        const discovered = this.sources.files.flatMap(file => this.systemsIn(file));
        const excluded = new Set(exclude);
        const kept = discovered.filter(system => !excluded.has(system.exported.className)).sort(bySourceOrder);
        for (const name of exclude) {
            if (!discovered.some(system => system.exported.className === name)) {
                this.warnings.push(`${SYSTEMS_MANIFEST_KEY}.exclude: "${name}" ${UNMATCHED_SYSTEM_EXCLUDE_WARNING}; remove it from ${PROJECT_MANIFEST_FILE}`);
            }
        }
        const lists: SystemList[] = [
            {file: GENERATED_SYSTEMS_FILE, exportName: GENERATED_SYSTEMS_EXPORT, systems: kept.filter(system => system.backend === undefined)},
            ...RENDER_BACKEND_KINDS.map(kind => ({
                file: generatedBackendSystemsFile(kind),
                exportName: generatedBackendSystemsExport(kind),
                systems: kept.filter(system => system.backend === kind),
            })),
        ];
        return {sources: lists.map(list => this.render(list)), warnings: this.warnings};
    }

    private systemsIn(file: string): DiscoveredSystem[] {
        const relativeFile = this.sources.relativeFile(file);
        const segments = relativeFile.split(PATH_SEPARATOR);
        const isBackendCode = segments[0] === BACKEND_FOLDER;
        const backendFolder = segments[BACKEND_KIND_SEGMENT];
        const backend = isBackendCode && segments.length >= FIRST_FILE_IN_KIND_FOLDER_SEGMENTS && isRenderBackendKind(backendFolder) ? backendFolder : undefined;
        const found: DiscoveredSystem[] = [];
        for (const exported of this.sources.exportedClassesIn(file)) {
            if (exported.isAbstract || !this.isSystem(exported)) continue;
            if (isBackendCode && backend === undefined) {
                this.reportOutsideBackendFolders(segments, relativeFile);
                continue;
            }
            if (exported.isDefaultExport) {
                this.warnings.push(`${exported.className}: default-exported systems are skipped; export it by name (${relativeFile})`);
                continue;
            }
            if (!this.sources.constructsWithoutArguments(exported.symbol)) {
                this.warnings.push(`${exported.className} ${SYSTEM_CONSTRUCTOR_ARGUMENTS_WARNING}; give it a constructor without parameters (${relativeFile})`);
                continue;
            }
            found.push({exported, backend});
        }
        return found;
    }

    private isSystem(exported: ExportedClass): boolean {
        return this.sources.classChain(exported.symbol).slice(1).some(ancestor => this.sources.isEngineClass(ancestor, ENGINE_SYSTEM_CLASS));
    }

    private reportOutsideBackendFolders(segments: readonly string[], relativeFile: string): void {
        const isInFolder = segments.length >= FIRST_FILE_IN_KIND_FOLDER_SEGMENTS;
        const place = isInFolder ? `${BACKEND_FOLDER}/${segments[BACKEND_KIND_SEGMENT]}/` : relativeFile;
        if (this.reportedBackendPlaces.has(place)) return;
        this.reportedBackendPlaces.add(place);
        const folders = RENDER_BACKEND_KINDS.map(kind => `${BACKEND_FOLDER}/${kind}/`).join(", ");
        this.warnings.push(`${place} ${OUTSIDE_BACKEND_FOLDERS_WARNING}; put backend code in ${folders}`);
    }

    private render(list: SystemList): GeneratedSource {
        const specifierOf = (target: string) => this.sources.importSpecifier(list.file, target);
        const imports = new ImportTable(reference => specifierOf(reference.fileName.replace(SOURCE_EXTENSION_PATTERN, "")), [SYSTEM_TYPE, SYSTEM_CTOR_TYPE, list.exportName]);
        for (const system of list.systems) imports.add(system.exported.reference);
        const engineCore = specifierOf(this.sources.engineModule(ENGINE_CORE_MODULE));
        const declaration = `export const ${list.exportName}: readonly ${SYSTEM_CTOR_TYPE}<${SYSTEM_TYPE}>[] = [`;
        const entries = list.systems.map(system => `${INDENT}${imports.localName(system.exported.reference)},`);
        const body = entries.length === 0 ? [`${declaration}];`] : [declaration, ...entries, "];"];
        const lines = [
            SYSTEMS_GENERATED_HEADER,
            `import type {${SYSTEM_TYPE}, ${SYSTEM_CTOR_TYPE}} from ${JSON.stringify(engineCore)};`,
            ...imports.importLines(),
            "",
            ...body,
        ];
        return {file: list.file, source: lines.join(LINE_BREAK) + LINE_BREAK};
    }
}

function systemsOf(sources: ProjectSources, exclude: readonly string[]): GeneratorOutput {
    return new SystemsGenerator(sources).generate(exclude);
}

export function generateProjectSystems(projectFolder: string, options: GenerateProjectSystemsOptions): GeneratorOutput {
    return systemsOf(ProjectSources.read(projectFolder, options.repoRoot), options.exclude ?? NO_EXCLUDED_NAMES);
}

export const SYSTEMS_GENERATOR: ProjectGenerator = {
    name: SYSTEMS_GENERATOR_NAME,
    version: SYSTEMS_GENERATOR_VERSION,
    files: [GENERATED_SYSTEMS_FILE, ...RENDER_BACKEND_KINDS.map(generatedBackendSystemsFile)],
    generate: sources => systemsOf(sources, sources.manifest?.systems?.exclude ?? NO_EXCLUDED_NAMES),
};
