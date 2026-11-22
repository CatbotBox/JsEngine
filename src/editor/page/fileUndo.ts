import type {ProjectEntry} from "../project/projectFileSystem";
import {isAncestorFolder, normalizeProjectPath, ROOT_FOLDER_PATH} from "./projectFiles";
import type {UndoCommand, UndoContext} from "./undoStack";

export interface ProjectFileOperations {
    list(): Promise<readonly ProjectEntry[]>;

    read(path: string): Promise<Uint8Array>;

    write(path: string, contents: Uint8Array | string): Promise<void>;

    remove(path: string): Promise<void>;

    rename(from: string, to: string): Promise<void>;

    makeDirectory(path: string): Promise<void>;
}

export interface SnapshotFile {
    readonly path: string;
    readonly contents: Uint8Array;
}

export interface FileTreeSnapshot {
    readonly path: string;
    readonly directories: readonly string[];
    readonly files: readonly SnapshotFile[];
}

export interface FileMove {
    readonly from: string;
    readonly to: string;
}

export class FileRestoreConflictError extends Error {
    public override readonly name = "FileRestoreConflictError";

    public constructor(path: string) {
        super(`${path} already exists, so this step cannot be undone or redone`);
    }
}

export class MissingFileError extends Error {
    public override readonly name = "MissingFileError";

    public constructor(path: string) {
        super(`${path} no longer exists in the project`);
    }
}

const PATH_SEPARATOR = "/";

function isInsideTree(root: string, path: string): boolean {
    return path === root || path.startsWith(root + PATH_SEPARATOR);
}

function byDepth(a: string, b: string): number {
    return a.split(PATH_SEPARATOR).length - b.split(PATH_SEPARATOR).length || a.localeCompare(b);
}

export function entriesInTree(entries: readonly ProjectEntry[], path: string): ProjectEntry[] {
    const root = normalizeProjectPath(path);
    if (root === ROOT_FOLDER_PATH) throw new Error("The project folder itself cannot be captured");
    return entries.filter(entry => isInsideTree(root, normalizeProjectPath(entry.path)));
}

export function treeSizeBytes(entries: readonly ProjectEntry[], path: string): number {
    return entriesInTree(entries, path).reduce((total, entry) => total + (entry.kind === "file" ? entry.size : 0), 0);
}

export async function captureFileTree(files: Pick<ProjectFileOperations, "list" | "read">, path: string): Promise<FileTreeSnapshot> {
    const root = normalizeProjectPath(path);
    const inside = entriesInTree(await files.list(), root);
    if (inside.length === 0) throw new MissingFileError(root);
    const directories = inside.filter(entry => entry.kind === "directory").map(entry => normalizeProjectPath(entry.path)).sort(byDepth);
    const filePaths = inside.filter(entry => entry.kind === "file").map(entry => normalizeProjectPath(entry.path)).sort(byDepth);
    const captured: SnapshotFile[] = [];
    for (const filePath of filePaths) captured.push({path: filePath, contents: await files.read(filePath)});
    return {path: root, directories, files: captured};
}

export function relocatedSnapshot(snapshot: FileTreeSnapshot, path: string): FileTreeSnapshot {
    const target = normalizeProjectPath(path);
    const relocate = (inside: string): string => target + inside.slice(snapshot.path.length);
    return {
        path: target,
        directories: snapshot.directories.map(relocate),
        files: snapshot.files.map(file => ({path: relocate(file.path), contents: file.contents})),
    };
}

export function newFileSnapshot(path: string, contents: string | Uint8Array): FileTreeSnapshot {
    const normalized = normalizeProjectPath(path);
    return {path: normalized, directories: [], files: [{path: normalized, contents: typeof contents === "string" ? new TextEncoder().encode(contents) : contents}]};
}

export function newFolderSnapshot(path: string): FileTreeSnapshot {
    const normalized = normalizeProjectPath(path);
    return {path: normalized, directories: [normalized], files: []};
}

export async function restoreFileTree(files: ProjectFileOperations, snapshot: FileTreeSnapshot): Promise<void> {
    const existing = (await files.list()).map(entry => normalizeProjectPath(entry.path));
    if (existing.some(path => isInsideTree(snapshot.path, path))) throw new FileRestoreConflictError(snapshot.path);
    for (const directory of snapshot.directories) await files.makeDirectory(directory);
    for (const file of snapshot.files) await files.write(file.path, file.contents);
}

export function topmostPaths(paths: readonly string[]): string[] {
    const normalized = [...new Set(paths.map(normalizeProjectPath))].filter(path => path !== ROOT_FOLDER_PATH);
    return normalized.filter(path => !normalized.some(other => other !== path && isAncestorFolder(other, path)));
}

export interface FileOperationObserver {
    moved(from: string, to: string): void;

    removed(path: string): void;

    changed(): void;
}

export class ObservedProjectFiles implements ProjectFileOperations {
    public constructor(private readonly files: () => ProjectFileOperations, private readonly observer: FileOperationObserver) {
    }

    public list(): Promise<readonly ProjectEntry[]> {
        return this.files().list();
    }

    public read(path: string): Promise<Uint8Array> {
        return this.files().read(path);
    }

    public async write(path: string, contents: Uint8Array | string): Promise<void> {
        await this.files().write(path, contents);
        this.observer.changed();
    }

    public async remove(path: string): Promise<void> {
        await this.files().remove(path);
        this.observer.removed(normalizeProjectPath(path));
        this.observer.changed();
    }

    public async rename(from: string, to: string): Promise<void> {
        await this.files().rename(from, to);
        this.observer.moved(normalizeProjectPath(from), normalizeProjectPath(to));
        this.observer.changed();
    }

    public async makeDirectory(path: string): Promise<void> {
        await this.files().makeDirectory(path);
        this.observer.changed();
    }
}

export class FileMoveCommand implements UndoCommand {
    public constructor(public readonly label: string, private readonly moves: readonly FileMove[]) {
    }

    public async undo(context: UndoContext): Promise<void> {
        for (let index = this.moves.length - 1; index >= 0; index--) await context.files.rename(this.moves[index].to, this.moves[index].from);
    }

    public async redo(context: UndoContext): Promise<void> {
        for (const move of this.moves) await context.files.rename(move.from, move.to);
    }
}

export class FileExistenceCommand implements UndoCommand {
    private trees: readonly FileTreeSnapshot[];

    public constructor(public readonly label: string, trees: readonly FileTreeSnapshot[], private readonly presentAfter: boolean) {
        this.trees = trees;
    }

    public get paths(): readonly string[] {
        return this.trees.map(tree => tree.path);
    }

    public undo(context: UndoContext): Promise<void> {
        return this.presentAfter ? this.remove(context.files) : this.restore(context.files);
    }

    public redo(context: UndoContext): Promise<void> {
        return this.presentAfter ? this.restore(context.files) : this.remove(context.files);
    }

    private async remove(files: ProjectFileOperations): Promise<void> {
        const current: FileTreeSnapshot[] = [];
        for (const tree of this.trees) current.push(await captureFileTree(files, tree.path));
        for (const tree of current) await files.remove(tree.path);
        this.trees = current;
    }

    private async restore(files: ProjectFileOperations): Promise<void> {
        for (const tree of this.trees) await restoreFileTree(files, tree);
    }
}
