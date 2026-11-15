const PATH_SEPARATOR = "/";
const PARENT_SEGMENT = "..";
const CURRENT_SEGMENT = ".";
const NUL_CHARACTER = "\0";
const BACKSLASH = /\\/g;
const DRIVE_PREFIX = /^[a-zA-Z]:/;

export function projectRelativePath(path: string): string | undefined {
    if (path.includes(NUL_CHARACTER)) return undefined;
    const unified = path.replace(BACKSLASH, PATH_SEPARATOR);
    if (unified.startsWith(PATH_SEPARATOR) || DRIVE_PREFIX.test(unified)) return undefined;
    const segments: string[] = [];
    for (const segment of unified.split(PATH_SEPARATOR)) {
        if (segment === "" || segment === CURRENT_SEGMENT) continue;
        if (segment === PARENT_SEGMENT) return undefined;
        segments.push(segment);
    }
    return segments.length === 0 ? undefined : segments.join(PATH_SEPARATOR);
}

export function requireProjectRelativePath(path: string): string {
    const relative = projectRelativePath(path);
    if (relative === undefined) throw new Error(`${JSON.stringify(path)} is not a path inside the project folder`);
    return relative;
}

export function projectPathSegments(path: string): string[] {
    return requireProjectRelativePath(path).split(PATH_SEPARATOR);
}

export function parentProjectPath(path: string): string | undefined {
    const end = path.lastIndexOf(PATH_SEPARATOR);
    return end < 0 ? undefined : path.slice(0, end);
}

export function joinProjectPath(directory: string | undefined, name: string): string {
    return directory === undefined || directory.length === 0 ? name : directory + PATH_SEPARATOR + name;
}

export function projectFileExtension(path: string): string {
    const name = path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1);
    const dot = name.lastIndexOf(".");
    return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export function isInsideProjectDirectory(path: string, directory: string): boolean {
    return path === directory || path.startsWith(directory + PATH_SEPARATOR);
}
