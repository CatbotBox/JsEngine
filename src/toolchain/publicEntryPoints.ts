import {readFileSync} from "fs";
import {join} from "path";
import {ENGINE_IMPORT_PREFIX} from "./projectLayout";
import {REPO_ROOT} from "./repoPaths";

export interface EnginePackage {
    readonly name: string;
    readonly folder: string;
    readonly entryPoints: readonly string[];
}

export interface PackageManifest {
    readonly name: string;
    readonly workspaces?: readonly string[];
    readonly exports?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
}

export const PACKAGE_MANIFEST_FILE = "package.json";
export const ENTRY_POINT_BARREL_FILE = "index.ts";
export const PACKAGE_ROOT_EXPORT = ".";

const ENTRY_POINT_SEPARATOR = "/";
const CLOSEST_ENTRY_POINT_LIMIT = 3;

interface EntryPointMatch {
    readonly entryPoint: string;
    readonly sharedSegments: number;
    readonly segments: number;
}

export function readPackageManifest(folder: string): PackageManifest {
    return JSON.parse(readFileSync(join(folder, PACKAGE_MANIFEST_FILE), "utf8")) as PackageManifest;
}

export function entryPointOfExport(packageName: string, subpath: string): string {
    return packageName.slice(ENGINE_IMPORT_PREFIX.length) + subpath.slice(PACKAGE_ROOT_EXPORT.length);
}

export function readEnginePackages(repoRoot: string): EnginePackage[] {
    return (readPackageManifest(repoRoot).workspaces ?? []).map(workspace => {
        const folder = join(repoRoot, workspace);
        const {name, exports} = readPackageManifest(folder);
        return {name, folder, entryPoints: Object.keys(exports ?? {}).map(subpath => entryPointOfExport(name, subpath))};
    });
}

export const ENGINE_PACKAGES: readonly EnginePackage[] = readEnginePackages(REPO_ROOT);
export const PUBLIC_ENTRY_POINTS: readonly string[] = ENGINE_PACKAGES.flatMap(enginePackage => enginePackage.entryPoints);

export function isPublicEntryPoint(path: string): boolean {
    return PUBLIC_ENTRY_POINTS.includes(path);
}

export function entryPointSegments(entryPoint: string): string[] {
    return entryPoint.split(ENTRY_POINT_SEPARATOR);
}

function sharedLeadingSegments(a: readonly string[], b: readonly string[]): number {
    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
    return shared;
}

function byCloseness(a: EntryPointMatch, b: EntryPointMatch): number {
    return b.sharedSegments - a.sharedSegments || a.segments - b.segments || (a.entryPoint < b.entryPoint ? -1 : a.entryPoint > b.entryPoint ? 1 : 0);
}

export function closestPublicEntryPoints(path: string): string[] {
    const requested = entryPointSegments(path);
    const matches = PUBLIC_ENTRY_POINTS.map((entryPoint): EntryPointMatch => {
        const segments = entryPointSegments(entryPoint);
        return {entryPoint, sharedSegments: sharedLeadingSegments(requested, segments), segments: segments.length};
    }).sort(byCloseness);
    const closest = matches[0].sharedSegments;
    return matches.filter(match => match.sharedSegments === closest).slice(0, CLOSEST_ENTRY_POINT_LIMIT).map(match => match.entryPoint);
}
