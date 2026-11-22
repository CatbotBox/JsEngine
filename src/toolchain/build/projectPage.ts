import {readFileSync} from "fs";
import {join} from "path";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {CliError} from "../cliArguments";
import {repoRelative, SOURCE_ROOT} from "../repoPaths";

export interface ProjectPageFields {
    readonly title: string;
    readonly defaultBackend: RenderBackendKind | undefined;
    readonly script: string;
    readonly stylesheet: string;
    readonly isolationScript: string;
}

export const PROJECT_PAGE_TEMPLATE = join(SOURCE_ROOT, "hosts", "web", "projectPage.html");

const TEMPLATE_FIELD = /\{\{(\w+)\}\}/g;
const HTML_SPECIAL_CHARACTERS = /[&<>"']/g;
const HTML_ESCAPES: ReadonlyMap<string, string> = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ["\"", "&quot;"], ["'", "&#39;"]]);
const PAGE_DEFAULT_BACKEND_UNSET = "";

function escapeHtml(text: string): string {
    return text.replace(HTML_SPECIAL_CHARACTERS, character => HTML_ESCAPES.get(character)!);
}

export function fillProjectPage(template: string, fields: ProjectPageFields): string {
    const values: ReadonlyMap<string, string> = new Map([
        ["title", fields.title],
        ["defaultBackend", fields.defaultBackend ?? PAGE_DEFAULT_BACKEND_UNSET],
        ["script", fields.script],
        ["stylesheet", fields.stylesheet],
        ["isolationScript", fields.isolationScript],
    ]);
    return template.replace(TEMPLATE_FIELD, (token, name: string) => {
        const value = values.get(name);
        if (value === undefined) throw new CliError(`${repoRelative(PROJECT_PAGE_TEMPLATE)} names ${token}, which the web build does not fill`);
        return escapeHtml(value);
    });
}

export function projectPageHtml(fields: ProjectPageFields): string {
    return fillProjectPage(readFileSync(PROJECT_PAGE_TEMPLATE, "utf8"), fields);
}
