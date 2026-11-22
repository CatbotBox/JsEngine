import {readdirSync} from "fs";
import {dirname, isAbsolute, join, relative, resolve} from "path";
import * as ts from "typescript";
import type {ProjectManifest} from "../../engine/project/projectManifest";
import {hasProjectManifest, readProjectManifest} from "../project";
import {ENGINE_IMPORT_PREFIX, GENERATED_FOLDER} from "../projectLayout";

export const SOURCE_EXTENSION_PATTERN = /\.tsx?$/;
export const DEFAULT_EXPORT_NAME = "default";

const EXCLUDED_FILE_SUFFIXES: readonly string[] = [".test.ts", ".test.tsx", ".d.ts"];
const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([".jsengine", "node_modules"]);
const SOURCE_PATH = ["src"];
const ENGINE_SOURCE_PATH = [...SOURCE_PATH, "engine"];
const BACKENDS_SOURCE_PATH = [...SOURCE_PATH, "backends"];
const ENGINE_PATHS_PATTERN = `${ENGINE_IMPORT_PREFIX}*`;
const RELATIVE_IMPORT_PREFIX = "./";
const PARENT_IMPORT_PREFIX = "../";

export interface ExportReference {
    readonly fileName: string;
    readonly exportName: string;
}

export interface ExportedClass {
    readonly symbol: ts.Symbol;
    readonly declaration: ts.ClassDeclaration;
    readonly className: string;
    readonly reference: ExportReference;
    readonly relativeFile: string;
    readonly isDefaultExport: boolean;
    readonly isAbstract: boolean;
}

export function toPosix(path: string): string {
    return path.replace(/\\/g, "/");
}

export function isInside(directory: string, target: string): boolean {
    const path = relative(directory, target);
    return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

export function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function isProjectSourceFile(name: string): boolean {
    const isSource = SOURCE_EXTENSION_PATTERN.test(name);
    const isExcluded = EXCLUDED_FILE_SUFFIXES.some(suffix => name.endsWith(suffix));
    return isSource && !isExcluded;
}

export function listProjectFiles(projectFolder: string, include: (name: string) => boolean): string[] {
    const found: string[] = [];
    const generatedFolder = join(projectFolder, GENERATED_FOLDER);
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name) && path !== generatedFolder) visit(path);
            } else if (include(entry.name)) {
                found.push(path);
            }
        }
    };
    visit(projectFolder);
    return found.sort((a, b) => compareText(toPosix(relative(projectFolder, a)), toPosix(relative(projectFolder, b))));
}

export function discoverProjectFiles(projectFolder: string): string[] {
    return listProjectFiles(projectFolder, isProjectSourceFile);
}

export function projectCompilerOptions(repoRoot: string): ts.CompilerOptions {
    return {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        strict: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
        paths: {[ENGINE_PATHS_PATTERN]: [toPosix(join(repoRoot, "src", "*"))]},
    };
}

function manifestOf(projectFolder: string): ProjectManifest | undefined {
    return hasProjectManifest(projectFolder) ? readProjectManifest(projectFolder) : undefined;
}

export class ProjectSources {
    public readonly checker: ts.TypeChecker;
    private readonly engineDirectory: string;
    private readonly backendsDirectory: string;
    private readonly projectInsideRepo: boolean;
    private readManifest: ProjectManifest | undefined;
    private manifestWasRead = false;

    private constructor(
        public readonly folder: string,
        public readonly repoRoot: string,
        public readonly files: readonly string[],
        public readonly program: ts.Program,
    ) {
        this.checker = program.getTypeChecker();
        this.engineDirectory = join(repoRoot, ...ENGINE_SOURCE_PATH);
        this.backendsDirectory = join(repoRoot, ...BACKENDS_SOURCE_PATH);
        this.projectInsideRepo = isInside(repoRoot, folder);
    }

    public static read(projectFolder: string, repoRoot: string): ProjectSources {
        const folder = resolve(projectFolder);
        const root = resolve(repoRoot);
        const files = discoverProjectFiles(folder);
        const program = ts.createProgram({rootNames: files, options: projectCompilerOptions(root)});
        return new ProjectSources(folder, root, files, program);
    }

    public get manifest(): ProjectManifest | undefined {
        if (!this.manifestWasRead) {
            this.readManifest = manifestOf(this.folder);
            this.manifestWasRead = true;
        }
        return this.readManifest;
    }

    public relativeFile(fileName: string): string {
        return toPosix(relative(this.folder, fileName));
    }

    public importSpecifier(generatedFile: string, target: string): string {
        const sourceDirectory = join(this.repoRoot, "src");
        if (!this.projectInsideRepo && isInside(sourceDirectory, target)) return ENGINE_IMPORT_PREFIX + toPosix(relative(sourceDirectory, target));
        const path = toPosix(relative(dirname(join(this.folder, generatedFile)), target));
        return path.startsWith(PARENT_IMPORT_PREFIX) ? path : RELATIVE_IMPORT_PREFIX + path;
    }

    public engineModule(...path: readonly string[]): string {
        return join(this.repoRoot, ...ENGINE_SOURCE_PATH, ...path);
    }

    public sourceModule(...path: readonly string[]): string {
        return join(this.repoRoot, ...SOURCE_PATH, ...path);
    }

    public projectModule(path: string): string {
        return join(this.folder, path.replace(SOURCE_EXTENSION_PATTERN, ""));
    }

    public resolveAlias(symbol: ts.Symbol): ts.Symbol {
        return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? this.checker.getAliasedSymbol(symbol) : symbol;
    }

    public isEngineSymbol(symbol: ts.Symbol): boolean {
        return (symbol.declarations ?? []).some(declaration => isInside(this.engineDirectory, declaration.getSourceFile().fileName));
    }

    public isEngineOrBackendSymbol(symbol: ts.Symbol): boolean {
        return (symbol.declarations ?? []).some(declaration => {
            const fileName = declaration.getSourceFile().fileName;
            return isInside(this.engineDirectory, fileName) || isInside(this.backendsDirectory, fileName);
        });
    }

    public isEngineClass(symbol: ts.Symbol, name: string): boolean {
        return symbol.name === name && (symbol.flags & ts.SymbolFlags.Class) !== 0 && this.isEngineSymbol(symbol);
    }

    public baseClassOf(symbol: ts.Symbol): ts.Symbol | undefined {
        const declared = this.checker.getDeclaredTypeOfSymbol(symbol);
        if (!declared.isClassOrInterface()) return undefined;
        const base = this.checker.getBaseTypes(declared)[0]?.symbol;
        return base !== undefined && (base.flags & ts.SymbolFlags.Class) !== 0 ? base : undefined;
    }

    public classChain(symbol: ts.Symbol): ts.Symbol[] {
        const chain: ts.Symbol[] = [];
        for (let current: ts.Symbol | undefined = symbol; current !== undefined && !chain.includes(current); current = this.baseClassOf(current)) {
            chain.push(current);
        }
        return chain;
    }

    public constructsWithoutArguments(classSymbol: ts.Symbol): boolean {
        const constructors = this.checker.getSignaturesOfType(this.checker.getTypeOfSymbol(classSymbol), ts.SignatureKind.Construct);
        return constructors.some(signature => signature.getParameters().every(parameter => this.isOptionalParameter(parameter)));
    }

    private isOptionalParameter(parameter: ts.Symbol): boolean {
        const declaration = parameter.valueDeclaration;
        if (declaration === undefined || !ts.isParameter(declaration)) return false;
        return declaration.dotDotDotToken !== undefined || this.checker.isOptionalParameter(declaration);
    }

    public exportedClassesIn(file: string): ExportedClass[] {
        const sourceFile = this.program.getSourceFile(file);
        const moduleSymbol = sourceFile && this.checker.getSymbolAtLocation(sourceFile);
        if (sourceFile === undefined || moduleSymbol === undefined) return [];
        const found: ExportedClass[] = [];
        for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
            const symbol = this.resolveAlias(exported);
            const declaration = symbol.declarations?.find(ts.isClassDeclaration);
            if (declaration === undefined || declaration.getSourceFile() !== sourceFile) continue;
            found.push({
                symbol,
                declaration,
                className: declaration.name?.text ?? exported.name,
                reference: {fileName: sourceFile.fileName, exportName: exported.name},
                relativeFile: this.relativeFile(sourceFile.fileName),
                isDefaultExport: exported.name === DEFAULT_EXPORT_NAME,
                isAbstract: (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract) !== 0,
            });
        }
        return found;
    }
}
