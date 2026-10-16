/**
 * Path helpers for loaders, independent of node's `path`. Both `/` and `\` separate segments;
 * results always use `/`, which every host's file source accepts (node's fs on Windows included).
 */

const DRIVE = /^[a-zA-Z]:/;

export function isAbsolutePath(path: string): boolean {
    return /^([a-zA-Z]:)?[\\/]/.test(path);
}

/** Collapses repeated separators and `.` segments and resolves `..` where it can, like node's `path.normalize`. */
export function normalizePath(path: string): string {
    const unified = path.replace(/\\/g, "/");
    const drive = DRIVE.exec(unified)?.[0] ?? "";
    const rest = unified.slice(drive.length);
    const absolute = rest.startsWith("/");
    const segments: string[] = [];
    for (const segment of rest.split("/")) {
        if (segment === "" || segment === ".") continue;
        if (segment !== "..") {
            segments.push(segment);
        } else if (segments.length > 0 && segments[segments.length - 1] !== "..") {
            segments.pop();
        } else if (!absolute) {
            segments.push("..");
        }
    }
    const body = segments.join("/");
    if (absolute) return drive + "/" + body;
    if (body.length > 0) return drive + body;
    return drive.length > 0 ? drive : ".";
}

export function joinPath(directory: string, relative: string): string {
    return normalizePath([directory, relative].filter(part => part.length > 0).join("/"));
}

/** The directory part of a file path: "." when it has none, the root itself for a file at the root. */
export function dirname(filePath: string): string {
    const end = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    if (end < 0) return ".";
    const drive = DRIVE.exec(filePath)?.[0] ?? "";
    if (end === drive.length) return filePath.slice(0, end + 1);
    return filePath.slice(0, end);
}
