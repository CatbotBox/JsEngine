import * as ts from "typescript";
import type {CacheableFileExtraction, ProjectProgramHost, ProjectSources} from "./projectSources";

type SourceFileCreation = ts.ScriptTarget | ts.CreateSourceFileOptions;

interface CachedSourceFile {
    readonly sourceFile: ts.SourceFile;
    verifiedInRound: number;
}

interface ResolvedImports {
    readonly sourceFile: ts.SourceFile;
    readonly resolvedFileNames: Map<string, string | undefined>;
}

interface CachedExtraction {
    readonly dependencies: ReadonlyMap<string, ts.SourceFile>;
    readonly result: unknown;
}

interface ProgramScope {
    readonly program: ts.Program;
    readonly globalScopeFiles: readonly ts.SourceFile[];
}

interface RevalidatedTable {
    holds(): boolean;
    clear(): void;
}

const MODE_KEY_SEPARATOR = "|";

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function creationMatches(sourceFile: ts.SourceFile, creation: SourceFileCreation): boolean {
    const options: ts.CreateSourceFileOptions = typeof creation === "object" ? creation : {languageVersion: creation};
    return sourceFile.languageVersion === options.languageVersion && sourceFile.impliedNodeFormat === options.impliedNodeFormat;
}

function modeAwareKey(name: string, mode: ts.ResolutionMode): string {
    return mode === undefined ? name : `${mode}${MODE_KEY_SEPARATOR}${name}`;
}

function declaresIntoGlobalScope(statement: ts.Statement): boolean {
    return ts.isModuleDeclaration(statement) && (ts.isStringLiteral(statement.name) || (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0);
}

function affectsGlobalScope(sourceFile: ts.SourceFile): boolean {
    return !ts.isExternalModule(sourceFile) || sourceFile.statements.some(declaresIntoGlobalScope);
}

function sameFiles(recorded: ReadonlyMap<string, ts.SourceFile>, current: ReadonlyMap<string, ts.SourceFile>): boolean {
    if (recorded.size !== current.size) return false;
    for (const [fileName, sourceFile] of current) {
        if (recorded.get(fileName) !== sourceFile) return false;
    }
    return true;
}

function sameEntries(recorded: readonly string[], current: readonly string[]): boolean {
    return recorded.length === current.length && recorded.every((entry, index) => entry === current[index]);
}

export class SourceFileCache {
    private readonly entries = new Map<string, CachedSourceFile>();
    private readonly createdHere = new WeakSet<ts.SourceFile>();
    private round = 0;
    private parsedInRound = 0;
    private optionsKey: string | undefined;

    public get parsedFiles(): number {
        return this.parsedInRound;
    }

    public beginRound(): void {
        this.round++;
        this.parsedInRound = 0;
    }

    public useOptions(options: ts.CompilerOptions): void {
        const key = JSON.stringify(options);
        if (key === this.optionsKey) return;
        this.entries.clear();
        this.optionsKey = key;
    }

    public isCached(sourceFile: ts.SourceFile): boolean {
        return this.createdHere.has(sourceFile);
    }

    public sourceFile(fileName: string, creation: SourceFileCreation, onError: ((message: string) => void) | undefined, shouldCreateNewSourceFile: boolean | undefined): ts.SourceFile | undefined {
        const cached = this.entries.get(fileName);
        const reusable = cached !== undefined && shouldCreateNewSourceFile !== true && creationMatches(cached.sourceFile, creation);
        if (reusable && cached.verifiedInRound === this.round) return cached.sourceFile;
        let text: string | undefined;
        try {
            text = ts.sys.readFile(fileName);
        } catch (error) {
            onError?.(messageOf(error));
            return ts.createSourceFile(fileName, "", creation);
        }
        if (text === undefined) {
            this.entries.delete(fileName);
            return undefined;
        }
        if (reusable && cached.sourceFile.text === text) {
            cached.verifiedInRound = this.round;
            return cached.sourceFile;
        }
        const sourceFile = ts.createSourceFile(fileName, text, creation);
        this.createdHere.add(sourceFile);
        this.entries.set(fileName, {sourceFile, verifiedInRound: this.round});
        this.parsedInRound++;
        return sourceFile;
    }
}

class ProbeTable<T> implements RevalidatedTable {
    private readonly results = new Map<string, T>();

    public constructor(private readonly probe: (path: string) => T, private readonly isSame: (recorded: T, current: T) => boolean) {
    }

    public read(path: string): T {
        if (this.results.has(path)) return this.results.get(path) as T;
        const result = this.probe(path);
        this.results.set(path, result);
        return result;
    }

    public holds(): boolean {
        for (const [path, recorded] of this.results) {
            if (!this.stillReads(path, recorded)) return false;
        }
        return true;
    }

    public clear(): void {
        this.results.clear();
    }

    private stillReads(path: string, recorded: T): boolean {
        try {
            return this.isSame(recorded, this.probe(path));
        } catch {
            return false;
        }
    }
}

export class FileSystemProbes {
    public readonly fileExists = new ProbeTable(path => ts.sys.fileExists(path), Object.is);
    public readonly directoryExists = new ProbeTable(path => ts.sys.directoryExists(path), Object.is);
    public readonly readFile = new ProbeTable(path => ts.sys.readFile(path), Object.is);
    public readonly realpath = new ProbeTable(path => ts.sys.realpath === undefined ? path : ts.sys.realpath(path), Object.is);
    public readonly directories = new ProbeTable(path => ts.sys.getDirectories(path), sameEntries);
    private readonly tables: readonly RevalidatedTable[] = [this.fileExists, this.directoryExists, this.readFile, this.realpath, this.directories];
    private generation = 0;

    public get epoch(): number {
        return this.generation;
    }

    public revalidate(): boolean {
        if (this.tables.every(table => table.holds())) return true;
        for (const table of this.tables) table.clear();
        this.generation++;
        return false;
    }
}

export class IncrementalProjectProgram implements ProjectProgramHost {
    private program: ts.Program | undefined;
    private programEpoch = 0;
    private reusedProgram = false;
    private scope: ProgramScope | undefined;
    private readonly importsByFile = new Map<string, ResolvedImports>();
    private readonly extractions = new Map<CacheableFileExtraction<unknown>, Map<string, CachedExtraction>>();
    private readonly extracted: string[] = [];

    public constructor(private readonly sourceFiles: SourceFileCache, private readonly probes: FileSystemProbes) {
    }

    public get reusedPreviousProgram(): boolean {
        return this.reusedProgram;
    }

    public get extractedFiles(): readonly string[] {
        return this.extracted;
    }

    public createProgram(rootNames: readonly string[], options: ts.CompilerOptions): ts.Program {
        this.sourceFiles.useOptions(options);
        const oldProgram = this.programEpoch === this.probes.epoch ? this.program : undefined;
        if (oldProgram === undefined) this.importsByFile.clear();
        this.extracted.length = 0;
        try {
            this.program = ts.createProgram({rootNames, options, host: this.compilerHost(options), oldProgram});
        } catch (error) {
            this.forget();
            throw error;
        }
        this.programEpoch = this.probes.epoch;
        this.reusedProgram = oldProgram !== undefined;
        this.forgetExtractionsOutside(rootNames);
        return this.program;
    }

    public extractFromFile<T>(sources: ProjectSources, file: string, extraction: CacheableFileExtraction<T>): T {
        const sourceFile = sources.program === this.program ? sources.program.getSourceFile(file) : undefined;
        const dependencies = sourceFile === undefined ? undefined : this.dependenciesOf(sources.program, sourceFile);
        if (dependencies === undefined) return this.extract(sources, file, extraction);
        const cachedByFile = this.cachedExtractionsOf(extraction);
        const cached = cachedByFile.get(file);
        if (cached !== undefined && sameFiles(cached.dependencies, dependencies)) return cached.result as T;
        const result = this.extract(sources, file, extraction);
        cachedByFile.set(file, {dependencies, result});
        return result;
    }

    private extract<T>(sources: ProjectSources, file: string, extraction: CacheableFileExtraction<T>): T {
        this.extracted.push(file);
        return extraction(sources, file);
    }

    private forget(): void {
        this.program = undefined;
        this.reusedProgram = false;
        this.scope = undefined;
        this.importsByFile.clear();
        this.extractions.clear();
    }

    private compilerHost(options: ts.CompilerOptions): ts.CompilerHost {
        const system = ts.createCompilerHost(options);
        const resolutionCache = ts.createModuleResolutionCache(system.getCurrentDirectory(), fileName => system.getCanonicalFileName(fileName), options);
        const probes = this.probes;
        const host: ts.CompilerHost = {
            ...system,
            getSourceFile: (fileName, creation, onError, shouldCreateNewSourceFile) => this.sourceFiles.sourceFile(fileName, creation, onError, shouldCreateNewSourceFile),
            fileExists: path => probes.fileExists.read(path),
            directoryExists: path => probes.directoryExists.read(path),
            readFile: path => probes.readFile.read(path),
            getDirectories: path => probes.directories.read(path),
            realpath: system.realpath === undefined ? undefined : path => probes.realpath.read(path),
            resolveModuleNameLiterals: (literals, containingFile, redirectedReference, compilerOptions, containingSourceFile) =>
                this.resolveImports(literals, containingFile, redirectedReference, compilerOptions, containingSourceFile, host, resolutionCache),
            getModuleResolutionCache: () => resolutionCache,
        };
        return host;
    }

    private resolveImports(
        literals: readonly ts.StringLiteralLike[],
        containingFile: string,
        redirectedReference: ts.ResolvedProjectReference | undefined,
        options: ts.CompilerOptions,
        containingSourceFile: ts.SourceFile,
        host: ts.ModuleResolutionHost,
        resolutionCache: ts.ModuleResolutionCache,
    ): ts.ResolvedModuleWithFailedLookupLocations[] {
        const imports = this.importsOf(containingSourceFile);
        const modeOptions = redirectedReference?.commandLine.options ?? options;
        const resolvedByKey = new Map<string, ts.ResolvedModuleWithFailedLookupLocations>();
        return literals.map(literal => {
            const mode = ts.getModeForUsageLocation(containingSourceFile, literal, modeOptions);
            const key = modeAwareKey(literal.text, mode);
            const resolution = resolvedByKey.get(key) ?? ts.resolveModuleName(literal.text, containingFile, options, host, resolutionCache, redirectedReference, mode);
            resolvedByKey.set(key, resolution);
            imports.resolvedFileNames.set(key, resolution.resolvedModule?.resolvedFileName);
            return resolution;
        });
    }

    private importsOf(sourceFile: ts.SourceFile): ResolvedImports {
        const known = this.importsByFile.get(sourceFile.fileName);
        if (known !== undefined && known.sourceFile === sourceFile) return known;
        const imports: ResolvedImports = {sourceFile, resolvedFileNames: new Map()};
        this.importsByFile.set(sourceFile.fileName, imports);
        return imports;
    }

    private globalScopeFiles(program: ts.Program): readonly ts.SourceFile[] {
        const known = this.scope;
        if (known !== undefined && known.program === program) return known.globalScopeFiles;
        const globalScopeFiles = program.getSourceFiles().filter(affectsGlobalScope);
        this.scope = {program, globalScopeFiles};
        return globalScopeFiles;
    }

    private dependenciesOf(program: ts.Program, sourceFile: ts.SourceFile): ReadonlyMap<string, ts.SourceFile> | undefined {
        const dependencies = new Map<string, ts.SourceFile>();
        const pending = [sourceFile, ...this.globalScopeFiles(program)];
        for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
            if (dependencies.has(next.fileName)) continue;
            if (!this.sourceFiles.isCached(next)) return undefined;
            dependencies.set(next.fileName, next);
            const imports = this.importsByFile.get(next.fileName);
            if (imports === undefined || imports.sourceFile !== next) continue;
            for (const resolvedFileName of imports.resolvedFileNames.values()) {
                const imported = resolvedFileName === undefined ? undefined : program.getSourceFile(resolvedFileName);
                if (imported !== undefined) pending.push(imported);
            }
        }
        return dependencies;
    }

    private cachedExtractionsOf(extraction: CacheableFileExtraction<unknown>): Map<string, CachedExtraction> {
        const known = this.extractions.get(extraction);
        if (known !== undefined) return known;
        const created = new Map<string, CachedExtraction>();
        this.extractions.set(extraction, created);
        return created;
    }

    private forgetExtractionsOutside(rootNames: readonly string[]): void {
        const roots = new Set(rootNames);
        for (const cachedByFile of this.extractions.values()) {
            for (const file of [...cachedByFile.keys()]) {
                if (!roots.has(file)) cachedByFile.delete(file);
            }
        }
    }
}
