import {compareText} from "./projectSources";
import type {ProjectSources} from "./projectSources";

export const GENERATED_LINE_BREAK = "\r\n";
export const GENERATED_INDENT = "    ";

export interface ModuleImport {
    readonly names: readonly string[];
    readonly module: string;
    readonly typeOnly?: boolean;
}

interface ImportGroup {
    readonly specifier: string;
    readonly typeOnly: boolean;
    readonly names: Set<string>;
}

function groupKey(specifier: string, typeOnly: boolean): string {
    return `${specifier}\0${typeOnly}`;
}

function byStatementOrder(a: ImportGroup, b: ImportGroup): number {
    return compareText(a.specifier, b.specifier) || Number(a.typeOnly) - Number(b.typeOnly);
}

export function importLines(sources: ProjectSources, generatedFile: string, imports: readonly ModuleImport[]): string[] {
    const groups = new Map<string, ImportGroup>();
    for (const each of imports) {
        const specifier = sources.importSpecifier(generatedFile, each.module);
        const typeOnly = each.typeOnly === true;
        const key = groupKey(specifier, typeOnly);
        const group = groups.get(key) ?? {specifier, typeOnly, names: new Set<string>()};
        for (const name of each.names) group.names.add(name);
        groups.set(key, group);
    }
    return [...groups.values()].sort(byStatementOrder)
        .map(group => `import ${group.typeOnly ? "type " : ""}{${[...group.names].sort(compareText).join(", ")}} from ${JSON.stringify(group.specifier)};`);
}

export function generatedText(lines: readonly string[]): string {
    return lines.join(GENERATED_LINE_BREAK) + GENERATED_LINE_BREAK;
}
