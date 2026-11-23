import {existsSync, writeFileSync} from "fs";
import {join} from "path";
import {CliError} from "./cliArguments";
import {displayPath} from "./project";
import {projectSlug} from "./projectLayout";
import {ENGINE_PACKAGES, PACKAGE_MANIFEST_FILE, readPackageManifest} from "./publicEntryPoints";
import {REPO_ROOT, slashed, SOURCE_ROOT} from "./repoPaths";

export const PROJECT_COMPILER_SETTINGS = {
    target: "ES2023",
    module: "Preserve",
    moduleResolution: "Bundler",
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    noEmit: true,
} as const;

const TSCONFIG_FILE = "tsconfig.json";
export const FEATURE_CONSTANTS_DECLARATION = join(SOURCE_ROOT, "engine", "platform", "features.d.ts");
export const TYPE_ROOTS: readonly string[] = [join(REPO_ROOT, "node_modules", "@types")];
export const AMBIENT_TYPE_PACKAGES: readonly string[] = ["node", "bun"];

const LINK_PROTOCOL = "link:";
const PROJECT_SOURCES = "**/*.ts";
const COMMONJS = "commonjs";
const PRIVATE = true;
const JSON_INDENT_SPACES = 2;
const INSTALL_COMMAND = "install";
const SUCCESS_EXIT_CODE = 0;

type JsonObject = Readonly<Record<string, unknown>>;

function jsonText(value: unknown): string {
    return JSON.stringify(value, null, JSON_INDENT_SPACES) + "\n";
}

function sortedEntries(record: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function engineDependencies(): Record<string, string> {
    return Object.fromEntries(ENGINE_PACKAGES.map(enginePackage => [enginePackage.name, LINK_PROTOCOL + slashed(enginePackage.folder)]));
}

export function linkedPackageManifest(folder: string): JsonObject {
    const existing: JsonObject = existsSync(join(folder, PACKAGE_MANIFEST_FILE))
        ? readPackageManifest(folder) as unknown as JsonObject
        : {name: projectSlug(folder), private: PRIVATE, type: COMMONJS};
    const dependencies = (existing.dependencies ?? {}) as Readonly<Record<string, string>>;
    return {...existing, dependencies: sortedEntries({...dependencies, ...engineDependencies()})};
}

export function projectTsconfig(): JsonObject {
    return {
        compilerOptions: {...PROJECT_COMPILER_SETTINGS, typeRoots: TYPE_ROOTS.map(slashed), types: [...AMBIENT_TYPE_PACKAGES]},
        include: [PROJECT_SOURCES],
        files: [slashed(FEATURE_CONSTANTS_DECLARATION)],
    };
}

export async function linkProject(folder: string): Promise<void> {
    writeFileSync(join(folder, PACKAGE_MANIFEST_FILE), jsonText(linkedPackageManifest(folder)));
    const tsconfig = join(folder, TSCONFIG_FILE);
    if (!existsSync(tsconfig)) writeFileSync(tsconfig, jsonText(projectTsconfig()));
    const install = Bun.spawn([process.execPath, INSTALL_COMMAND], {cwd: folder, stdout: "inherit", stderr: "inherit"});
    const exitCode = await install.exited;
    if (exitCode !== SUCCESS_EXIT_CODE) throw new CliError(`bun ${INSTALL_COMMAND} in ${displayPath(folder)} exited with ${exitCode}`);
}
