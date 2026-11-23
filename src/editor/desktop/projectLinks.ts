import {readFile, realpath} from "fs/promises";
import {dirname, join} from "path";

const PACKAGE_MANIFEST_FILE = "package.json";
const NODE_MODULES_FOLDER = "node_modules";
const PACKAGE_NAME_SEPARATOR = "/";

interface EnginePackageFolder {
    readonly name: string;
    readonly folder: string;
}

interface PackageManifestFields {
    readonly name?: unknown;
    readonly workspaces?: unknown;
}

async function packageManifestOf(folder: string): Promise<PackageManifestFields> {
    return JSON.parse(await readFile(join(folder, PACKAGE_MANIFEST_FILE), "utf8")) as PackageManifestFields;
}

function isStringList(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every(item => typeof item === "string");
}

export function folderKey(folder: string): string {
    return process.platform === "win32" ? folder.toLowerCase() : folder;
}

async function enginePackagesOf(repoRoot: string): Promise<EnginePackageFolder[]> {
    const {workspaces} = await packageManifestOf(repoRoot);
    if (!isStringList(workspaces)) throw new Error(`${join(repoRoot, PACKAGE_MANIFEST_FILE)} has no "workspaces" list`);
    return await Promise.all(workspaces.map(async workspace => {
        const folder = join(repoRoot, workspace);
        const {name} = await packageManifestOf(folder);
        if (typeof name !== "string") throw new Error(`${join(folder, PACKAGE_MANIFEST_FILE)} has no "name"`);
        return {name, folder};
    }));
}

async function realFolderOf(path: string): Promise<string | undefined> {
    return await realpath(path).catch(() => undefined);
}

async function resolvedPackageFolder(projectFolder: string, packageName: string): Promise<string | undefined> {
    let folder = projectFolder;
    for (;;) {
        const found = await realFolderOf(join(folder, NODE_MODULES_FOLDER, ...packageName.split(PACKAGE_NAME_SEPARATOR)));
        if (found !== undefined) return found;
        const parent = dirname(folder);
        if (parent === folder) return undefined;
        folder = parent;
    }
}

async function resolvesToCheckout(projectFolder: string, enginePackage: EnginePackageFolder): Promise<boolean> {
    const [resolved, checkout] = await Promise.all([resolvedPackageFolder(projectFolder, enginePackage.name), realFolderOf(enginePackage.folder)]);
    return resolved !== undefined && checkout !== undefined && folderKey(resolved) === folderKey(checkout);
}

export async function isLinkedToCheckout(projectFolder: string, repoRoot: string): Promise<boolean> {
    const enginePackages = await enginePackagesOf(repoRoot);
    const linked = await Promise.all(enginePackages.map(enginePackage => resolvesToCheckout(projectFolder, enginePackage)));
    return linked.every(Boolean);
}
