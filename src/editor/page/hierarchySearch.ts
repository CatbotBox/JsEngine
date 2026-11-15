export interface HierarchySearch {
    readonly nameText: string;
    readonly typeNames: readonly string[];
}

export const TYPE_FILTER_PREFIX = "t:";
export const EMPTY_SEARCH: HierarchySearch = {nameText: "", typeNames: []};

const WHITESPACE = /\s+/;
const NAME_TERM_SEPARATOR = " ";

export function parseHierarchySearch(text: string): HierarchySearch {
    const nameTerms: string[] = [];
    const typeNames: string[] = [];
    for (const token of text.trim().split(WHITESPACE)) {
        if (token.length === 0) continue;
        if (token.toLowerCase().startsWith(TYPE_FILTER_PREFIX)) {
            const typeName = token.slice(TYPE_FILTER_PREFIX.length).toLowerCase();
            if (typeName.length > 0) typeNames.push(typeName);
            continue;
        }
        nameTerms.push(token.toLowerCase());
    }
    return {nameText: nameTerms.join(NAME_TERM_SEPARATOR), typeNames};
}

export function isEmptySearch(search: HierarchySearch): boolean {
    return search.nameText.length === 0 && search.typeNames.length === 0;
}

export function matchesHierarchySearch(search: HierarchySearch, label: string, componentTypeNames: readonly string[]): boolean {
    if (search.nameText.length > 0 && !label.toLowerCase().includes(search.nameText)) return false;
    return search.typeNames.every(wanted => componentTypeNames.some(typeName => typeName.toLowerCase().startsWith(wanted)));
}
