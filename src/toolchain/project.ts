import {existsSync, readFileSync} from "fs";
import {join, relative, resolve} from "path";
import {PROJECT_MANIFEST_FILE, validateProjectManifest} from "../engine/project/projectManifest";
import type {ProjectManifest} from "../engine/project/projectManifest";
import {declaredTargets, targetRenderDefaults, TARGETS_MANIFEST_KEY} from "../engine/project/projectTargets";
import type {ProjectTarget, TargetRenderDefaults} from "../engine/project/projectTargets";
import {CliError, usageError} from "./cliArguments";
import {slashed} from "./repoPaths";

const CURRENT_FOLDER = ".";

export function displayPath(path: string): string {
    const fromHere = slashed(relative(process.cwd(), path));
    return fromHere.length === 0 ? CURRENT_FOLDER : fromHere;
}

export function hasProjectManifest(folder: string): boolean {
    return existsSync(join(folder, PROJECT_MANIFEST_FILE));
}

export function projectFolderOf(projectOption: string | undefined): string {
    const folder = resolve(projectOption ?? CURRENT_FOLDER);
    if (hasProjectManifest(folder)) return folder;
    const fix = projectOption === undefined ? "pass --project <folder> naming a JsEngine project" : "point --project at a folder that holds one";
    throw usageError(`${displayPath(folder)} has no ${PROJECT_MANIFEST_FILE}; ${fix}`);
}

export function readProjectManifest(folder: string): ProjectManifest {
    const validation = validateProjectManifest(readFileSync(join(folder, PROJECT_MANIFEST_FILE), "utf8"), path => existsSync(join(folder, path)));
    if (validation.ok) return validation.manifest;
    throw new CliError(`${displayPath(join(folder, PROJECT_MANIFEST_FILE))} has problems; fix them and try again`, validation.problems);
}

export function declaredTargetDefaults(folder: string, target: ProjectTarget): TargetRenderDefaults {
    const manifest = readProjectManifest(folder);
    const declared = declaredTargets(manifest.targets);
    if (declared.includes(target)) return targetRenderDefaults(manifest.targets, target);
    throw usageError(`${displayPath(join(folder, PROJECT_MANIFEST_FILE))} does not list the ${target} target under "${TARGETS_MANIFEST_KEY}" (it lists ${declared.join(", ")}); add "${target}": {} there, or pick one of those`);
}
