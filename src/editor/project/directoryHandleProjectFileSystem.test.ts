import {describe, expect, test} from "../../engine/testing/harness";
import {DirectoryHandleProjectFileSystem} from "./directoryHandleProjectFileSystem";
import type {DirectoryHandleLike, FileHandleLike, FileLike, HandleCreateOptions, HandleRemoveOptions, WritableFileLike} from "./directoryHandleProjectFileSystem";
import type {ProjectFileChange} from "./projectFileSystem";

class NotFoundError extends Error {
    public override readonly name = "NotFoundError";
}

class MemoryFile implements FileHandleLike {
    public readonly kind = "file";
    public lastModified: number;

    public constructor(public readonly name: string, public bytes: Uint8Array, private readonly clock: () => number) {
        this.lastModified = clock();
    }

    public async getFile(): Promise<FileLike> {
        const bytes = this.bytes;
        return {size: bytes.length, lastModified: this.lastModified, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer};
    }

    public async createWritable(): Promise<WritableFileLike> {
        const chunks: Uint8Array[] = [];
        return {
            write: async data => {
                chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
            },
            close: async () => {
                const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const joined = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) {
                    joined.set(chunk, offset);
                    offset += chunk.length;
                }
                this.bytes = joined;
                this.lastModified = this.clock();
            },
        };
    }
}

class MemoryDirectory implements DirectoryHandleLike {
    public readonly kind = "directory";
    public readonly children = new Map<string, MemoryFile | MemoryDirectory>();

    public constructor(public readonly name: string, private readonly clock: () => number) {
    }

    public async* values(): AsyncIterable<MemoryFile | MemoryDirectory> {
        for (const child of [...this.children.values()]) yield child;
    }

    public async getDirectoryHandle(name: string, options?: HandleCreateOptions): Promise<MemoryDirectory> {
        const child = this.children.get(name);
        if (child instanceof MemoryDirectory) return child;
        if (child !== undefined) throw new TypeError(`${name} is a file`);
        if (options?.create !== true) throw new NotFoundError(`${name} not found`);
        const created = new MemoryDirectory(name, this.clock);
        this.children.set(name, created);
        return created;
    }

    public async getFileHandle(name: string, options?: HandleCreateOptions): Promise<MemoryFile> {
        const child = this.children.get(name);
        if (child instanceof MemoryFile) return child;
        if (child !== undefined) throw new TypeError(`${name} is a directory`);
        if (options?.create !== true) throw new NotFoundError(`${name} not found`);
        const created = new MemoryFile(name, new Uint8Array(0), this.clock);
        this.children.set(name, created);
        return created;
    }

    public async removeEntry(name: string, options?: HandleRemoveOptions): Promise<void> {
        const child = this.children.get(name);
        if (child === undefined) throw new NotFoundError(`${name} not found`);
        if (child instanceof MemoryDirectory && child.children.size > 0 && options?.recursive !== true) throw new Error(`${name} is not empty`);
        this.children.delete(name);
    }
}

function memoryRoot(): MemoryDirectory {
    let now = 0;
    return new MemoryDirectory("game", () => ++now);
}

async function rejection(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise;
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

describe("DirectoryHandleProjectFileSystem", () => {
    test("writes create folders, reads return the bytes, and the listing walks the tree but skips tool folders", async () => {
        const root = memoryRoot();
        const files = new DirectoryHandleProjectFileSystem(root);
        await files.write("scenes/main.scene.json", "{}");
        await files.write("jsengine.project.json", new TextEncoder().encode("{\"name\":\"g\"}"));
        await files.write(".jsengine/build/editor.worker.js", "code");
        await files.makeDirectory("empty");
        expect(await files.readText("scenes/main.scene.json")).toBe("{}");
        expect(await files.readText(".jsengine/build/editor.worker.js")).toBe("code");
        expect((await files.list()).map(entry => `${entry.kind} ${entry.path} ${entry.size}`)).toEqual([
            "directory empty 0",
            "file jsengine.project.json 12",
            "directory scenes 0",
            "file scenes/main.scene.json 2",
        ]);
        expect(files.rootLabel).toBe("game");
    });

    test("rename moves files and folders, refusing existing targets and moves into themselves", async () => {
        const files = new DirectoryHandleProjectFileSystem(memoryRoot());
        await files.write("a/one.txt", "1");
        await files.write("a/deep/two.txt", "2");
        await files.write("b.txt", "b");
        await files.rename("b.txt", "c/b.txt");
        await files.rename("a", "moved");
        expect((await files.list()).filter(entry => entry.kind === "file").map(entry => entry.path)).toEqual(["c/b.txt", "moved/deep/two.txt", "moved/one.txt"]);
        expect(await rejection(files.rename("moved/one.txt", "c/b.txt"))).toBe("Cannot rename moved/one.txt to c/b.txt: c/b.txt already exists");
        expect(await rejection(files.rename("moved", "moved/inner"))).toBe("Cannot move moved into itself (moved/inner)");
        expect(await rejection(files.rename("ghost.txt", "x.txt"))).toBe("Cannot rename ghost.txt: it does not exist");
    });

    test("remove deletes recursively and paths leaving the folder are refused", async () => {
        const files = new DirectoryHandleProjectFileSystem(memoryRoot());
        await files.write("a/one.txt", "1");
        await files.remove("a");
        expect(await files.list()).toEqual([]);
        expect(await rejection(files.read("../outside.txt"))).toBe(`"../outside.txt" is not a path inside the project folder`);
    });

    test("polling reports added, changed and removed paths while someone listens", async () => {
        const files = new DirectoryHandleProjectFileSystem(memoryRoot(), {pollIntervalMs: 60_000});
        await files.write("a.txt", "1");
        await files.write("b.txt", "2");
        const changes: ProjectFileChange[] = [];
        const stop = files.onChange(change => changes.push(change));
        await new Promise(done => setTimeout(done, 0));
        await files.write("a.txt", "changed");
        await files.remove("b.txt");
        await files.write("c.txt", "3");
        await files.poll();
        stop();
        expect(changes).toEqual([{paths: ["a.txt", "b.txt", "c.txt"]}]);
    });
});
