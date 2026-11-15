import type {ProjectEntry, ProjectFileChange, ProjectFileSystem} from "./projectFileSystem";
import {joinProjectPath, projectPathSegments} from "./projectPaths";

export interface FileLike {
    readonly size: number;
    readonly lastModified: number;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface WritableFileLike {
    write(data: Uint8Array | string): Promise<void>;
    close(): Promise<void>;
}

export interface FileHandleLike {
    readonly kind: "file";
    readonly name: string;
    getFile(): Promise<FileLike>;
    createWritable(): Promise<WritableFileLike>;
}

export interface HandleCreateOptions {
    readonly create?: boolean;
}

export interface HandleRemoveOptions {
    readonly recursive?: boolean;
}

export interface DirectoryHandleLike {
    readonly kind: "directory";
    readonly name: string;
    values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
    getDirectoryHandle(name: string, options?: HandleCreateOptions): Promise<DirectoryHandleLike>;
    getFileHandle(name: string, options?: HandleCreateOptions): Promise<FileHandleLike>;
    removeEntry(name: string, options?: HandleRemoveOptions): Promise<void>;
}

export interface DirectoryHandleProjectFileSystemOptions {
    readonly pollIntervalMs?: number;
}

export const DEFAULT_DIRECTORY_POLL_INTERVAL_MS = 1500;
export const IGNORED_PROJECT_DIRECTORY_NAMES: ReadonlySet<string> = new Set([".git", "node_modules", ".jsengine"]);

const CREATE: HandleCreateOptions = {create: true};
const RECURSIVE: HandleRemoveOptions = {recursive: true};
const DIRECTORY_SIZE = 0;
const DIRECTORY_MTIME_MS = 0;

function byPath(a: ProjectEntry, b: ProjectEntry): number {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function signatureOf(entry: ProjectEntry): string {
    return `${entry.kind}:${entry.size}:${entry.mtimeMs}`;
}

export class DirectoryHandleProjectFileSystem implements ProjectFileSystem {
    public readonly rootLabel: string;
    private readonly pollIntervalMs: number;
    private readonly listeners = new Set<(change: ProjectFileChange) => void>();
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private polling = false;
    private lastSnapshot: ReadonlyMap<string, string> | undefined;

    public constructor(private readonly root: DirectoryHandleLike, options: DirectoryHandleProjectFileSystemOptions = {}) {
        this.rootLabel = root.name;
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_DIRECTORY_POLL_INTERVAL_MS;
    }

    public async list(): Promise<readonly ProjectEntry[]> {
        const entries: ProjectEntry[] = [];
        await this.collect(this.root, undefined, entries);
        return entries.sort(byPath);
    }

    public async read(path: string): Promise<Uint8Array> {
        const file = await (await this.fileHandle(path)).getFile();
        return new Uint8Array(await file.arrayBuffer());
    }

    public async readText(path: string): Promise<string> {
        return new TextDecoder("utf-8", {ignoreBOM: true}).decode(await this.read(path));
    }

    public async write(path: string, contents: Uint8Array | string): Promise<void> {
        const segments = projectPathSegments(path);
        const directory = await this.directoryOf(segments.slice(0, -1), CREATE);
        const handle = await directory.getFileHandle(segments[segments.length - 1], CREATE);
        const writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
    }

    public async remove(path: string): Promise<void> {
        const segments = projectPathSegments(path);
        const directory = await this.directoryOf(segments.slice(0, -1));
        await directory.removeEntry(segments[segments.length - 1], RECURSIVE);
    }

    public async rename(from: string, to: string): Promise<void> {
        const source = projectPathSegments(from).join("/");
        const target = projectPathSegments(to).join("/");
        if (source === target) return;
        if (target.startsWith(source + "/")) throw new Error(`Cannot move ${source} into itself (${target})`);
        if (await this.kindOf(target) !== undefined) throw new Error(`Cannot rename ${source} to ${target}: ${target} already exists`);
        const kind = await this.kindOf(source);
        if (kind === undefined) throw new Error(`Cannot rename ${source}: it does not exist`);
        if (kind === "file") await this.write(target, await this.read(source));
        else await this.copyDirectory(source, target);
        await this.remove(source);
    }

    public async makeDirectory(path: string): Promise<void> {
        await this.directoryOf(projectPathSegments(path), CREATE);
    }

    public onChange(listener: (change: ProjectFileChange) => void): () => void {
        const entry = (change: ProjectFileChange) => listener(change);
        this.listeners.add(entry);
        if (this.pollTimer === undefined) {
            this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
            void this.poll();
        }
        return () => {
            this.listeners.delete(entry);
            if (this.listeners.size > 0 || this.pollTimer === undefined) return;
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
            this.lastSnapshot = undefined;
        };
    }

    public async poll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;
        try {
            const snapshot = new Map((await this.list()).map(entry => [entry.path, signatureOf(entry)]));
            const previous = this.lastSnapshot;
            this.lastSnapshot = snapshot;
            if (previous === undefined) return;
            const paths = [...new Set([...snapshot.keys(), ...previous.keys()])].filter(path => snapshot.get(path) !== previous.get(path)).sort();
            if (paths.length === 0) return;
            for (const listener of [...this.listeners]) listener({paths});
        } catch (error) {
            console.warn(`Could not poll the project folder ${this.rootLabel}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.polling = false;
        }
    }

    private async collect(directory: DirectoryHandleLike, path: string | undefined, entries: ProjectEntry[]): Promise<void> {
        for await (const handle of directory.values()) {
            const childPath = joinProjectPath(path, handle.name);
            if (handle.kind === "file") {
                const file = await handle.getFile();
                entries.push({path: childPath, kind: "file", size: file.size, mtimeMs: file.lastModified});
            } else if (!IGNORED_PROJECT_DIRECTORY_NAMES.has(handle.name)) {
                entries.push({path: childPath, kind: "directory", size: DIRECTORY_SIZE, mtimeMs: DIRECTORY_MTIME_MS});
                await this.collect(handle, childPath, entries);
            }
        }
    }

    private async directoryOf(segments: readonly string[], options?: HandleCreateOptions): Promise<DirectoryHandleLike> {
        let directory = this.root;
        for (const segment of segments) directory = await directory.getDirectoryHandle(segment, options);
        return directory;
    }

    private async fileHandle(path: string): Promise<FileHandleLike> {
        const segments = projectPathSegments(path);
        const directory = await this.directoryOf(segments.slice(0, -1));
        return await directory.getFileHandle(segments[segments.length - 1]);
    }

    private async kindOf(path: string): Promise<"file" | "directory" | undefined> {
        const segments = projectPathSegments(path);
        let directory: DirectoryHandleLike;
        try {
            directory = await this.directoryOf(segments.slice(0, -1));
        } catch {
            return undefined;
        }
        const name = segments[segments.length - 1];
        for await (const handle of directory.values()) {
            if (handle.name === name) return handle.kind;
        }
        return undefined;
    }

    private async copyDirectory(source: string, target: string): Promise<void> {
        await this.makeDirectory(target);
        const sourceDirectory = await this.directoryOf(projectPathSegments(source));
        for await (const handle of sourceDirectory.values()) {
            const from = joinProjectPath(source, handle.name);
            const to = joinProjectPath(target, handle.name);
            if (handle.kind === "file") await this.write(to, await this.read(from));
            else await this.copyDirectory(from, to);
        }
    }
}
