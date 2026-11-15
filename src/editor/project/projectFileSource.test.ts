import {describe, expect, test} from "../../engine/testing/harness";
import {ProjectFileNotLoadedError, ProjectFileSource} from "./projectFileSource";
import type {ProjectFilesChannel} from "./projectFileSource";
import {serveProjectFiles} from "./projectFileServing";
import type {ProjectFilesPort} from "./projectFileServing";
import type {ProjectEntry, ProjectFileChange, ProjectFileSystem} from "./projectFileSystem";
import {isProjectFilesPageMessage, isProjectFilesWorldMessage, PROJECT_FILES_MESSAGE_TYPE} from "./projectFilesProtocol";

type MessageListener = (event: {readonly data: unknown}) => void;

class MemoryProjectFiles implements ProjectFileSystem {
    public readonly rootLabel = "memory";
    public readonly reads: string[] = [];
    private readonly listeners = new Set<(change: ProjectFileChange) => void>();
    private readonly files = new Map<string, {bytes: Uint8Array, mtimeMs: number}>();

    public constructor(files: Readonly<Record<string, string>>) {
        for (const [path, text] of Object.entries(files)) this.put(path, text);
    }

    public put(path: string, text: string, mtimeMs = 1): void {
        this.files.set(path, {bytes: new TextEncoder().encode(text), mtimeMs});
    }

    public changed(paths: readonly string[]): void {
        for (const listener of [...this.listeners]) listener({paths});
    }

    public async list(): Promise<readonly ProjectEntry[]> {
        return [...this.files].map(([path, file]) => ({path, kind: "file" as const, size: file.bytes.length, mtimeMs: file.mtimeMs}));
    }

    public async read(path: string): Promise<Uint8Array> {
        this.reads.push(path);
        const file = this.files.get(path);
        if (file === undefined) throw new Error(`no ${path}`);
        return file.bytes.slice();
    }

    public async readText(path: string): Promise<string> {
        return new TextDecoder().decode(await this.read(path));
    }

    public async write(): Promise<void> {
    }

    public async remove(): Promise<void> {
    }

    public async rename(): Promise<void> {
    }

    public async makeDirectory(): Promise<void> {
    }

    public onChange(listener: (change: ProjectFileChange) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

function channelPair(): {readonly world: ProjectFilesChannel, readonly page: ProjectFilesPort} {
    const worldListeners = new Set<MessageListener>();
    const pageListeners = new Set<MessageListener>();
    return {
        world: {
            postMessage: message => queueMicrotask(() => {
                for (const listener of pageListeners) listener({data: structuredClone(message)});
            }),
            addEventListener: (_type, listener) => worldListeners.add(listener),
        },
        page: {
            postMessage: (message, transfer) => queueMicrotask(() => {
                for (const listener of worldListeners) listener({data: structuredClone(message, {transfer})});
            }),
            addEventListener: (_type, listener) => pageListeners.add(listener),
        },
    };
}

async function connected(files: MemoryProjectFiles): Promise<ProjectFileSource> {
    const pair = channelPair();
    const source = new ProjectFileSource(pair.world);
    serveProjectFiles(pair.page, files);
    await source.whenListed();
    return source;
}

function settle(): Promise<void> {
    return new Promise(done => setTimeout(done, 0));
}

describe("project files protocol", () => {
    test("guards accept the messages each side sends and reject others", () => {
        expect(isProjectFilesWorldMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "read", requestId: 1, path: "a.obj"})).toBe(true);
        expect(isProjectFilesWorldMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "read", requestId: -1, path: "a.obj"})).toBe(false);
        expect(isProjectFilesPageMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "listing", files: [{path: "a", size: 1, mtimeMs: 2}]})).toBe(true);
        expect(isProjectFilesPageMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "listing", files: [{path: "a", size: -1, mtimeMs: 2}]})).toBe(false);
        expect(isProjectFilesPageMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "contents", requestId: 3, ok: true, bytes: new ArrayBuffer(1)})).toBe(true);
        expect(isProjectFilesPageMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "contents", requestId: 3, ok: false, error: "gone"})).toBe(true);
        expect(isProjectFilesPageMessage({type: "jsengine-editor", kind: "listing", files: []})).toBe(false);
    });
});

describe("ProjectFileSource", () => {
    test("lists and stats files from the page listing before any bytes are loaded", async () => {
        const source = await connected(new MemoryProjectFiles({"b.txt": "bee", "a/cube.obj": "v 0 0 0"}));
        expect(source.list()).toEqual([{path: "a/cube.obj", size: 7}, {path: "b.txt", size: 3}]);
        expect(source.exists("./b.txt")).toBe(true);
        expect(source.exists("c.txt")).toBe(false);
        expect(source.stat("b.txt")).toEqual({size: 3, mtimeMs: 1});
        expect(() => source.readText("b.txt")).toThrow(ProjectFileNotLoadedError);
        expect(() => source.readText("c.txt")).toThrow("ENOENT");
    });

    test("ensureLoaded fetches listed files once, reports progress and skips unknown paths", async () => {
        const files = new MemoryProjectFiles({"b.txt": "bee", "c.txt": "cc"});
        const source = await connected(files);
        const progress: string[] = [];
        await source.ensureLoaded(["b.txt", "./b.txt", "c.txt", "missing.txt"], update => progress.push(`${update.loadedFiles}/${update.totalFiles} ${update.loadedBytes}/${update.totalBytes}`));
        await source.ensureLoaded(["b.txt"]);
        expect(source.readText("b.txt")).toBe("bee");
        expect(files.reads.sort()).toEqual(["b.txt", "c.txt"]);
        expect(progress[0]).toBe("0/2 0/5");
        expect(progress[progress.length - 1]).toBe("2/2 5/5");
    });

    test("a changed listing drops stale bytes so the next ensureLoaded fetches again", async () => {
        const files = new MemoryProjectFiles({"b.txt": "bee"});
        const source = await connected(files);
        await source.ensureLoaded(["b.txt"]);
        files.put("b.txt", "buzz", 2);
        files.changed(["b.txt"]);
        await settle();
        expect(source.isLoaded("b.txt")).toBe(false);
        await source.ensureLoaded(["b.txt"]);
        expect(source.readText("b.txt")).toBe("buzz");
    });

    test("loadFetchingAsNeeded fetches each file the loader reads, including ones it swallowed, until it succeeds", async () => {
        const files = new MemoryProjectFiles({"model.obj": "obj", "model.obj.cache": "cache", "texture.png": "png"});
        const source = await connected(files);
        let attempts = 0;
        const result = await source.loadFetchingAsNeeded(() => {
            attempts++;
            let body: string;
            try {
                body = source.readText("model.obj.cache");
            } catch {
                body = source.readText("model.obj");
            }
            return body + "+" + source.readText("texture.png");
        });
        expect(result).toBe("cache+png");
        expect(attempts).toBe(3);
        expect(source.isLoaded("model.obj")).toBe(false);
    });

    test("loadFetchingAsNeeded rethrows errors that are not about unloaded files", async () => {
        const source = await connected(new MemoryProjectFiles({"a.txt": "a"}));
        let failure: unknown;
        try {
            await source.loadFetchingAsNeeded(() => source.readText("not-in-project.txt"));
        } catch (error) {
            failure = error;
        }
        expect(String(failure).includes("ENOENT")).toBe(true);
    });

    test("a failed read rejects ensureLoaded with the page's reason", async () => {
        const files = new MemoryProjectFiles({"a.txt": "a"});
        const source = await connected(files);
        files.read = async () => {
            throw new Error("disk on fire");
        };
        let failure: unknown;
        try {
            await source.ensureLoaded(["a.txt"]);
        } catch (error) {
            failure = error;
        }
        expect(failure instanceof Error && failure.message === "Could not read project file a.txt: disk on fire").toBe(true);
    });

    test("a failed listing rejects whenListed", async () => {
        const pair = channelPair();
        const source = new ProjectFileSource(pair.world);
        const files = new MemoryProjectFiles({});
        files.list = async () => {
            throw new Error("no access");
        };
        serveProjectFiles(pair.page, files);
        let failure: unknown;
        try {
            await source.whenListed();
        } catch (error) {
            failure = error;
        }
        expect(failure instanceof Error && failure.message === "Could not list the project files: no access").toBe(true);
    });
});
