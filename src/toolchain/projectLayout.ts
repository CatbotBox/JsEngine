import {basename, isAbsolute, relative, resolve} from "path";
import type {RenderBackendKind} from "../engine/rendering/renderBackend";
import {REPO_ROOT, slashed} from "./repoPaths";

export const ENGINE_IMPORT_PREFIX = "@jsengine/";
export const GENERATED_FOLDER = "generated";
export const GENERATED_SCHEMAS_FILE = `${GENERATED_FOLDER}/schemas.ts`;
export const GENERATED_SCHEMAS_EXPORT = "generatedSchemas";
export const GENERATED_SYSTEMS_FILE = `${GENERATED_FOLDER}/systems.ts`;
export const GENERATED_SYSTEMS_EXPORT = "generatedSystems";
export const GENERATED_GAME_FILE = `${GENERATED_FOLDER}/game.ts`;
export const DEFAULT_ENTRY_FILE = GENERATED_GAME_FILE;
export const START_PROJECT_EXPORT = "startProject";
export const TERMINAL_MAIN_FILE = `${GENERATED_FOLDER}/main.terminal.ts`;
export const WEB_PAGE_BOOTSTRAP_FILE = `${GENERATED_FOLDER}/main.web.ts`;
export const EDITOR_WORKER_MAIN_FILE = `${GENERATED_FOLDER}/main.editor.worker.ts`;
export const BACKEND_FOLDER = "backend";
export const WEB_BUNDLE_EXTENSION = ".js";

const GENERATED_EXPORT_PREFIX = "generated";
const SYSTEMS_EXPORT_SUFFIX = "Systems";
const WORKER_BUNDLE_SUFFIX = ".worker";
const SLUG_UNSAFE_CHARACTERS = /[^a-z0-9]+/g;
const SLUG_SEPARATOR = "-";
const SLUG_EDGE_SEPARATORS = /^-+|-+$/g;
const DEFAULT_SLUG = "game";
const PARENT_SEGMENT = "..";

export function generatedBackendSystemsFile(kind: RenderBackendKind): string {
    return `${GENERATED_FOLDER}/systems.${kind}.ts`;
}

export function generatedBackendSystemsExport(kind: RenderBackendKind): string {
    return `${GENERATED_EXPORT_PREFIX}${kind.charAt(0).toUpperCase()}${kind.slice(1)}${SYSTEMS_EXPORT_SUFFIX}`;
}

export function webPageMainFile(kind: RenderBackendKind): string {
    return `${GENERATED_FOLDER}/main.web-${kind}.ts`;
}

export function webWorkerMainFile(kind: RenderBackendKind): string {
    return `${GENERATED_FOLDER}/main.web-${kind}.worker.ts`;
}

export function projectSlug(projectFolder: string): string {
    const slug = basename(resolve(projectFolder)).toLowerCase().replace(SLUG_UNSAFE_CHARACTERS, SLUG_SEPARATOR).replace(SLUG_EDGE_SEPARATORS, "");
    return slug.length > 0 ? slug : DEFAULT_SLUG;
}

export function projectSiteDirectory(projectFolder: string): string {
    const fromRepo = relative(REPO_ROOT, resolve(projectFolder));
    const insideRepo = fromRepo.length > 0 && !isAbsolute(fromRepo) && !fromRepo.startsWith(PARENT_SEGMENT);
    return insideRepo ? slashed(fromRepo) : projectSlug(projectFolder);
}

export function webPageBootstrapBundle(slug: string): string {
    return slug;
}

export function webPageBundle(slug: string, kind: RenderBackendKind): string {
    return `${slug}-${kind}`;
}

export function webWorkerBundle(slug: string, kind: RenderBackendKind): string {
    return `${webPageBundle(slug, kind)}${WORKER_BUNDLE_SUFFIX}`;
}

export function webBundleFile(bundle: string): string {
    return bundle + WEB_BUNDLE_EXTENSION;
}
