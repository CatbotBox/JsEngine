import {beforeEach, describe, expect, test} from "../../engine/testing/harness";
import type {ProjectEntry} from "../project/projectFileSystem";
import {
    captureFileTree,
    FileExistenceCommand,
    FileMoveCommand,
    FileRestoreConflictError,
    MissingFileError,
    newFileSnapshot,
    newFolderSnapshot,
    ObservedProjectFiles,
    relocatedSnapshot,
    restoreFileTree,
    topmostPaths,
    treeSizeBytes,
} from "./fileUndo";
import type {ProjectFileOperations} from "./fileUndo";
import {EntityRefs, UndoStack} from "./undoStack";
import type {EditorRequester} from "./undoStack";

const PATH_SEPARATOR = "/";
const NO_WORLD = {} as EditorRequester;

class MemoryProjectFiles implements ProjectFileOperations {
    public readonly files = new Map<string, Uint8Array>();
    public readonly directories = new Set<string>();
    public readonly log: string[] = [];

    public async list(): Promise<readonly ProjectEntry[]> {
        return [
            ...[...this.directories].map((path): ProjectEntry => ({path, kind: "directory", size: 0, mtimeMs: 0})),
            ...[...this.files].map(([path, contents]): ProjectEntry => ({path, kind: "file", size: contents.length, mtimeMs: 0})),
        ];
    }

    public async read(path: string): Promise<Uint8Array> {
        const contents = this.files.get(path);
        if (contents === undefined) throw new Error(`no file ${path}`);
        return contents;
    }

    public text(path: string): string | undefined {
        const contents = this.files.get(path);
        return contents === undefined ? undefined : new TextDecoder().decode(contents);
    }

    public async write(path: string, contents: Uint8Array | string): Promise<void> {
        this.log.push(`write ${path}`);
        this.addParents(path);
        this.files.set(path, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
    }

    public async remove(path: string): Promise<void> {
        this.log.push(`remove ${path}`);
        if (!this.files.has(path) && !this.directories.has(path)) throw new Error(`no ${path}`);
        for (const file of [...this.files.keys()]) if (file === path || file.startsWith(path + PATH_SEPARATOR)) this.files.delete(file);
        for (const directory of [...this.directories]) if (directory === path || directory.startsWith(path + PATH_SEPARATOR)) this.directories.delete(directory);
    }

    public async rename(from: string, to: string): Promise<void> {
        this.log.push(`rename ${from} ${to}`);
        if (this.files.has(to) || this.directories.has(to)) throw new Error(`${to} already exists`);
        const moved = (path: string): string => to + path.slice(from.length);
        for (const [file, contents] of [...this.files]) {
            if (file !== from && !file.startsWith(from + PATH_SEPARATOR)) continue;
            this.files.delete(file);
            this.files.set(moved(file), contents);
        }
        for (const directory of [...this.directories]) {
            if (directory !== from && !directory.startsWith(from + PATH_SEPARATOR)) continue;
            this.directories.delete(directory);
            this.directories.add(moved(directory));
        }
        this.addParents(to);
    }

    public async makeDirectory(path: string): Promise<void> {
        this.log.push(`mkdir ${path}`);
        this.addParents(path);
        this.directories.add(path);
    }

    private addParents(path: string): void {
        const parts = path.split(PATH_SEPARATOR);
        for (let end = 1; end < parts.length; end++) this.directories.add(parts.slice(0, end).join(PATH_SEPARATOR));
    }
}

let files: MemoryProjectFiles;
let stack: UndoStack;

beforeEach(async () => {
    files = new MemoryProjectFiles();
    stack = new UndoStack({client: NO_WORLD, refs: new EntityRefs(), files});
    await files.write("art/a.png", "A");
    await files.write("art/sub/b.png", "B");
    await files.makeDirectory("art/empty");
    await files.write("scenes/main.scene.json", "{}");
    files.log.length = 0;
});

describe("file tree snapshots", () => {
    test("a capture holds every folder and file under the path, parents first", async () => {
        const snapshot = await captureFileTree(files, "art");
        expect(snapshot.path).toBe("art");
        expect(snapshot.directories).toEqual(["art", "art/empty", "art/sub"]);
        expect(snapshot.files.map(file => file.path)).toEqual(["art/a.png", "art/sub/b.png"]);
    });

    test("capturing a missing path fails and the project root cannot be captured", async () => {
        let missing: unknown;
        try {
            await captureFileTree(files, "nope");
        } catch (error) {
            missing = error;
        }
        expect(missing).toBeInstanceOf(MissingFileError);
        let root: unknown;
        try {
            await captureFileTree(files, "");
        } catch (error) {
            root = error;
        }
        expect(root).toBeInstanceOf(Error);
    });

    test("a capture relocated and restored copies the tree, empty folders included", async () => {
        await restoreFileTree(files, relocatedSnapshot(await captureFileTree(files, "art"), "art 1"));
        expect(files.text("art 1/a.png")).toBe("A");
        expect(files.text("art 1/sub/b.png")).toBe("B");
        expect(files.directories.has("art 1/empty")).toBe(true);
        expect(files.text("art/a.png")).toBe("A");
    });

    test("restoring over an existing path is refused before anything is written", async () => {
        let failure: unknown;
        try {
            await restoreFileTree(files, newFileSnapshot("art/a.png", "other"));
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(FileRestoreConflictError);
        expect(files.log).toEqual([]);
        expect(files.text("art/a.png")).toBe("A");
    });

    test("tree sizes add the files under a path and topmost paths drop paths inside others", async () => {
        const entries = await files.list();
        expect(treeSizeBytes(entries, "art")).toBe(2);
        expect(treeSizeBytes(entries, "art/sub")).toBe(1);
        expect(topmostPaths(["art/sub/b.png", "art", "scenes/main.scene.json", "art", "", "art 2"])).toEqual(["art", "scenes/main.scene.json", "art 2"]);
    });
});

describe("file operation undo", () => {
    test("a move undoes back to where it came from, in reverse order, and redoes", async () => {
        await files.rename("art/a.png", "scenes/a.png");
        await files.rename("art/sub", "scenes/sub");
        stack.push(new FileMoveCommand("Move 2 items", [{from: "art/a.png", to: "scenes/a.png"}, {from: "art/sub", to: "scenes/sub"}]));
        files.log.length = 0;
        expect(await stack.undo()).toBe(true);
        expect(files.log).toEqual(["rename scenes/sub art/sub", "rename scenes/a.png art/a.png"]);
        expect(files.text("art/a.png")).toBe("A");
        expect(files.text("art/sub/b.png")).toBe("B");
        await stack.redo();
        expect(files.text("scenes/a.png")).toBe("A");
        expect(files.text("scenes/sub/b.png")).toBe("B");
        expect(files.files.has("art/a.png")).toBe(false);
    });

    test("undoing a delete restores the folder with its contents, and redo deletes it again", async () => {
        const snapshot = await captureFileTree(files, "art");
        await files.remove("art");
        stack.push(new FileExistenceCommand("Delete art", [snapshot], false));
        expect(files.text("art/a.png")).toBeUndefined();
        await stack.undo();
        expect(files.text("art/a.png")).toBe("A");
        expect(files.text("art/sub/b.png")).toBe("B");
        expect(files.directories.has("art/empty")).toBe(true);
        await stack.redo();
        expect(files.text("art/a.png")).toBeUndefined();
        expect(files.directories.has("art")).toBe(false);
    });

    test("undoing a creation removes the file, and redo brings back the contents it had when undone", async () => {
        await files.write("prefabs/enemy.prefab.json", "first");
        stack.push(new FileExistenceCommand("Create Prefab", [newFileSnapshot("prefabs/enemy.prefab.json", "first")], true));
        await files.write("prefabs/enemy.prefab.json", "edited");
        await stack.undo();
        expect(files.text("prefabs/enemy.prefab.json")).toBeUndefined();
        await stack.redo();
        expect(files.text("prefabs/enemy.prefab.json")).toBe("edited");
    });

    test("an empty folder's creation undoes and redoes", async () => {
        await files.makeDirectory("levels");
        stack.push(new FileExistenceCommand("Create Folder", [newFolderSnapshot("levels")], true));
        await stack.undo();
        expect(files.directories.has("levels")).toBe(false);
        await stack.redo();
        expect(files.directories.has("levels")).toBe(true);
    });

    test("undo fails with a reason, and overwrites nothing, when the restored path was taken in the meantime", async () => {
        const snapshot = await captureFileTree(files, "art/a.png");
        await files.remove("art/a.png");
        stack.push(new FileExistenceCommand("Delete a.png", [snapshot], false));
        await files.write("art/a.png", "replacement");
        let failure: unknown;
        try {
            await stack.undo();
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(FileRestoreConflictError);
        expect(files.text("art/a.png")).toBe("replacement");
    });
});

describe("observed project files", () => {
    test("moves, removals and every change reach the observer with normalized paths", async () => {
        const seen: string[] = [];
        const observed = new ObservedProjectFiles(() => files, {
            moved: (from, to) => seen.push(`moved ${from} ${to}`),
            removed: path => seen.push(`removed ${path}`),
            changed: () => seen.push("changed"),
        });
        await observed.rename("./art/a.png", "art\\c.png");
        await observed.remove("art/sub");
        await observed.write("x.txt", "x");
        await observed.makeDirectory("y");
        expect(seen).toEqual(["moved art/a.png art/c.png", "changed", "removed art/sub", "changed", "changed", "changed"]);
    });
});
