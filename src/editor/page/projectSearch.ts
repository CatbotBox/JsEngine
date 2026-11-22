import {isEmptySearch, matchesHierarchySearch, parseHierarchySearch} from "./hierarchySearch";
import {baseNameOf, PROJECT_ITEM_KIND_TITLES} from "./projectFiles";
import type {ProjectItemKind, ProjectItemRef} from "./projectFiles";

export const PROJECT_SEARCH_PLACEHOLDER = "Search files (t:image, t:scene… filter by kind)";

const SPACES = /\s+/g;
const FOLDERS_FIRST: Readonly<Record<"folder" | "file", number>> = {folder: 0, file: 1};

function kindNames(kind: ProjectItemKind): string[] {
    return [kind, PROJECT_ITEM_KIND_TITLES[kind].replace(SPACES, "")];
}

function searchOrder(a: ProjectItemRef, b: ProjectItemRef): number {
    const group = FOLDERS_FIRST[a.kind === "folder" ? "folder" : "file"] - FOLDERS_FIRST[b.kind === "folder" ? "folder" : "file"];
    if (group !== 0) return group;
    return baseNameOf(a.path).localeCompare(baseNameOf(b.path), undefined, {sensitivity: "base", numeric: true}) || a.path.localeCompare(b.path);
}

export function isProjectSearchActive(text: string): boolean {
    return !isEmptySearch(parseHierarchySearch(text));
}

export function projectSearchResults(items: readonly ProjectItemRef[], text: string): ProjectItemRef[] {
    const search = parseHierarchySearch(text);
    return items.filter(item => matchesHierarchySearch(search, baseNameOf(item.path), kindNames(item.kind))).sort(searchOrder);
}
