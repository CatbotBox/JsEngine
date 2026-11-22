import {readFileSync} from "fs";
import {extname} from "path";
import * as ts from "typescript";
import {KEEP_MANIFEST_KEY, PROJECT_MANIFEST_FILE, SCENE_FILE_SUFFIX} from "../../engine/project/projectManifest";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {DATA_ASSET_FILE_SUFFIX} from "../../engine/scene/dataAssetDocument";
import {PREFAB_FILE_SUFFIX} from "../../engine/scene/fieldSchema";
import {ALL_CATALOG_SCHEMAS, BACKEND_CATALOG, BACKEND_SCHEMA_CATALOG, ENGINE_CATALOG, IMAGE_DECODER_CATALOG} from "./engineCatalog";
import type {CatalogImageDecoder, CatalogPassList, CatalogSchema} from "./engineCatalog";
import {compareText, listProjectFiles} from "./projectSources";
import type {ProjectSources} from "./projectSources";

export const UNKNOWN_DATA_TYPE_WARNING = "which no engine, backend or project schema provides";
export const UNMATCHED_KEEP_WARNING = "matches no engine, backend or project schema";
export const UNREADABLE_DATA_FILE_WARNING = "could not be read for its type names";

export interface ProjectSchemaSummary {
    readonly typeNames: readonly string[];
    readonly assetKinds: readonly string[];
    readonly hasOwnSchemaClasses: boolean;
}

export interface ProjectReachability {
    readonly engineSchemas: readonly CatalogSchema[];
    readonly imageDecoders: readonly CatalogImageDecoder[];
    readonly warnings: readonly string[];

    hostSchemas(kind: RenderBackendKind): readonly CatalogSchema[];

    otherBackendTypeNames(kind: RenderBackendKind): readonly string[];

    passLists(kind: RenderBackendKind): readonly CatalogPassList[];
}

interface NamedType {
    readonly name: string;
    readonly file: string;
}

type JsonObject = {readonly [key: string]: unknown};

const DATA_FILE_SUFFIXES: readonly string[] = [SCENE_FILE_SUFFIX, PREFAB_FILE_SUFFIX, DATA_ASSET_FILE_SUFFIX];
const TYPE_ROLES: ReadonlySet<CatalogSchema["role"]> = new Set(["component", "resource"]);

function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDataFile(name: string): boolean {
    const lower = name.toLowerCase();
    return DATA_FILE_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

function keysOf(value: unknown): string[] {
    return isJsonObject(value) ? Object.keys(value) : [];
}

function typeNamesInDocument(document: unknown): string[] {
    if (!isJsonObject(document)) return [];
    if (typeof document.type === "string") return [document.type];
    const entities = Array.isArray(document.entities) ? document.entities : [];
    const components = entities.flatMap(entity => isJsonObject(entity) ? keysOf(entity.components) : []);
    return [...components, ...keysOf(document.resources)];
}

function containsAll(names: ReadonlySet<string>, required: readonly string[]): boolean {
    return required.every(name => names.has(name));
}

function uniqueSorted(names: Iterable<string>): string[] {
    return [...new Set(names)].sort(compareText);
}

class ReachabilityAnalysis {
    private readonly names = new Set<string>();
    private readonly warnings: string[] = [];
    private readonly knownNames: ReadonlySet<string>;

    public constructor(private readonly sources: ProjectSources, private readonly summary: ProjectSchemaSummary) {
        this.knownNames = new Set([...ALL_CATALOG_SCHEMAS.filter(schema => TYPE_ROLES.has(schema.role)).map(schema => schema.name), ...summary.typeNames]);
    }

    public run(): ProjectReachability {
        for (const named of this.dataTypeNames()) this.addDataName(named);
        for (const binding of this.sources.manifest?.resources ?? []) this.names.add(binding.type);
        for (const name of this.sources.manifest?.keep ?? []) this.addKeptName(name);
        for (const name of this.codeClassNames()) this.addCodeClassName(name);
        for (const kind of this.summary.assetKinds) this.names.add(kind);
        if (this.summary.hasOwnSchemaClasses) this.addEveryEngineAssetKind();
        this.closeOverAssetKinds();
        const names: ReadonlySet<string> = this.names;
        const isReachable = (schema: CatalogSchema) => names.has(schema.name);
        return {
            engineSchemas: ENGINE_CATALOG.filter(isReachable),
            imageDecoders: this.imageDecoders(),
            warnings: this.warnings,
            hostSchemas: kind => BACKEND_CATALOG[kind].hostSchemas.filter(isReachable),
            otherBackendTypeNames: kind => uniqueSorted(BACKEND_SCHEMA_CATALOG
                .filter(schema => TYPE_ROLES.has(schema.role) && !BACKEND_CATALOG[kind].hostSchemas.includes(schema))
                .map(schema => schema.name)),
            passLists: kind => BACKEND_CATALOG[kind].passLists.filter(list => containsAll(names, list.requiredTypes)),
        };
    }

    private addDataName(named: NamedType): void {
        this.names.add(named.name);
        if (!this.knownNames.has(named.name)) this.warnings.push(`${named.file} names "${named.name}", ${UNKNOWN_DATA_TYPE_WARNING}`);
    }

    private addKeptName(name: string): void {
        this.names.add(name);
        if (!this.knownNames.has(name)) this.warnings.push(`${KEEP_MANIFEST_KEY}: "${name}" ${UNMATCHED_KEEP_WARNING}; remove it from ${PROJECT_MANIFEST_FILE}`);
    }

    private addCodeClassName(className: string): void {
        for (const schema of ALL_CATALOG_SCHEMAS) {
            if (schema.namedByCode && schema.className === className && TYPE_ROLES.has(schema.role)) this.names.add(schema.name);
        }
    }

    private addEveryEngineAssetKind(): void {
        for (const schema of ENGINE_CATALOG) {
            if (schema.role === "assetType") this.names.add(schema.name);
        }
    }

    private closeOverAssetKinds(): void {
        for (let added = true; added;) {
            added = false;
            for (const schema of ALL_CATALOG_SCHEMAS) {
                if (!this.names.has(schema.name)) continue;
                for (const kind of schema.assetKinds) {
                    if (this.names.has(kind)) continue;
                    this.names.add(kind);
                    added = true;
                }
            }
        }
    }

    private dataTypeNames(): NamedType[] {
        return listProjectFiles(this.sources.folder, isDataFile).flatMap(path => {
            const file = this.sources.relativeFile(path);
            try {
                return uniqueSorted(typeNamesInDocument(JSON.parse(readFileSync(path, "utf8")))).map(name => ({name, file}));
            } catch (error) {
                this.warnings.push(`${file} ${UNREADABLE_DATA_FILE_WARNING}: ${error instanceof Error ? error.message : String(error)}`);
                return [];
            }
        });
    }

    private codeClassNames(): Set<string> {
        const names = new Set<string>();
        const checker = this.sources.checker;
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node)) {
                const symbol = checker.getSymbolAtLocation(node);
                const resolved = symbol === undefined ? undefined : this.sources.resolveAlias(symbol);
                const isClass = resolved !== undefined && (resolved.flags & ts.SymbolFlags.Class) !== 0;
                if (isClass && this.sources.isEngineOrBackendSymbol(resolved)) names.add(resolved.name);
            }
            ts.forEachChild(node, visit);
        };
        for (const file of this.sources.files) {
            const sourceFile = this.sources.program.getSourceFile(file);
            if (sourceFile !== undefined) visit(sourceFile);
        }
        return names;
    }

    private imageDecoders(): CatalogImageDecoder[] {
        const extensions = new Set(listProjectFiles(this.sources.folder, () => true).map(path => extname(path).toLowerCase()));
        return IMAGE_DECODER_CATALOG.filter(decoder => decoder.extensions.some(extension => extensions.has(extension)));
    }
}

const reachabilityBySources = new WeakMap<ProjectSources, ProjectReachability>();

export function projectReachability(sources: ProjectSources, summary: ProjectSchemaSummary): ProjectReachability {
    const known = reachabilityBySources.get(sources);
    if (known !== undefined) return known;
    const reachability = new ReachabilityAnalysis(sources, summary).run();
    reachabilityBySources.set(sources, reachability);
    return reachability;
}
