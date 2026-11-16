import type {FileSource, FileStat} from "../../engine/platform/platform";
import {normalizePath} from "../../engine/platform/paths";
import type {ProjectAssetFile, ProjectAssetFiles, ProjectLoadProgressListener} from "./projectEntry";
import {isProjectFilesPageMessage, PROJECT_FILES_MESSAGE_TYPE} from "./projectFilesProtocol";
import type {ProjectFilesPageMessage, ProjectFilesWorldMessage, ProjectListedFile} from "./projectFilesProtocol";

export interface ProjectFilesChannel {
    postMessage(message: ProjectFilesWorldMessage): void;
    addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void;
}

export class ProjectFileNotLoadedError extends Error {
    public override readonly name = "ProjectFileNotLoadedError";

    public constructor(public readonly path: string) {
        super(`${path} is a project file that is not loaded yet; await files.ensureLoaded or files.loadFetchingAsNeeded before reading it`);
    }
}

interface PendingRead {
    readonly path: string;
    resolve(bytes: Uint8Array): void;
    reject(error: Error): void;
}

interface Deferred {
    readonly promise: Promise<void>;
    resolve(): void;
    reject(error: Error): void;
}

const FIRST_REQUEST_ID = 1;
const EXTRA_PASSES_BEYOND_LISTING = 1;

function deferred(): Deferred {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return {promise, resolve, reject};
}

function notFound(path: string): Error {
    const error = new Error(`ENOENT: no such file or directory, not in the project: ${path}`) as Error & {code: string};
    error.code = "ENOENT";
    return error;
}

function sameListedFile(a: ProjectListedFile, b: ProjectListedFile): boolean {
    return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

export class ProjectFileSource implements FileSource, ProjectAssetFiles {
    private listing = new Map<string, ProjectListedFile>();
    private sortedListing: readonly ProjectAssetFile[] = [];
    private readonly loaded = new Map<string, Uint8Array>();
    private readonly fetches = new Map<string, Promise<void>>();
    private readonly pending = new Map<number, PendingRead>();
    private readonly listed = deferred();
    private nextRequestId = FIRST_REQUEST_ID;
    private missRecorder: string[] | undefined;

    public constructor(private readonly channel: ProjectFilesChannel) {
        this.listed.promise.catch(() => undefined);
        channel.addEventListener("message", event => {
            if (isProjectFilesPageMessage(event.data)) this.receive(event.data);
        });
    }

    public whenListed(): Promise<void> {
        return this.listed.promise;
    }

    public readBytes(path: string): Uint8Array {
        const key = normalizePath(path);
        const bytes = this.loaded.get(key);
        if (bytes !== undefined) return bytes;
        if (!this.listing.has(key)) throw notFound(path);
        this.missRecorder?.push(key);
        throw new ProjectFileNotLoadedError(key);
    }

    public readText(path: string): string {
        return new TextDecoder("utf-8", {ignoreBOM: true}).decode(this.readBytes(path));
    }

    public exists(path: string): boolean {
        const key = normalizePath(path);
        return this.listing.has(key) || this.loaded.has(key);
    }

    public stat(path: string): FileStat {
        const listed = this.listing.get(normalizePath(path));
        if (listed === undefined) throw notFound(path);
        return {size: listed.size, mtimeMs: listed.mtimeMs};
    }

    public isLoaded(path: string): boolean {
        return this.loaded.has(normalizePath(path));
    }

    public list(): readonly ProjectAssetFile[] {
        return this.sortedListing;
    }

    public async ensureLoaded(paths: readonly string[], onProgress?: ProjectLoadProgressListener): Promise<void> {
        const wanted = [...new Set(paths.map(normalizePath))].filter(path => this.listing.has(path) && !this.loaded.has(path));
        const totalBytes = wanted.reduce((sum, path) => sum + this.listing.get(path)!.size, 0);
        let loadedFiles = 0;
        let loadedBytes = 0;
        const report = () => onProgress?.({loadedFiles, totalFiles: wanted.length, loadedBytes, totalBytes});
        report();
        await Promise.all(wanted.map(async path => {
            const size = this.listing.get(path)?.size ?? 0;
            await this.fetchOnce(path);
            loadedFiles++;
            loadedBytes += size;
            report();
        }));
    }

// A mesh's files are only known by loading it, and the mesh cache reader swallows a missing read, so fetch only the first unloaded read per pass.
    public async loadFetchingAsNeeded<T>(load: () => T, onProgress?: ProjectLoadProgressListener): Promise<T> {
        const fetched = new Set<string>();
        let finishedBytes = 0;
        const maxPasses = this.listing.size + EXTRA_PASSES_BEYOND_LISTING;
        for (let pass = 0; pass <= maxPasses; pass++) {
            const misses: string[] = [];
            this.missRecorder = misses;
            let result: T | undefined;
            let failure: unknown;
            let failed = false;
            try {
                result = load();
            } catch (error) {
                failure = error;
                failed = true;
            } finally {
                this.missRecorder = undefined;
            }
            const next = misses.find(path => !this.loaded.has(path));
            if (next === undefined) {
                if (failed) throw failure;
                return result as T;
            }
            if (fetched.has(next)) throw failed ? failure : new Error(`${next} was fetched but its loader still could not read it`);
            fetched.add(next);
            const before = finishedBytes;
            await this.ensureLoaded([next], progress => onProgress?.({
                loadedFiles: fetched.size - 1 + progress.loadedFiles,
                totalFiles: fetched.size,
                loadedBytes: before + progress.loadedBytes,
                totalBytes: before + progress.totalBytes,
            }));
            finishedBytes += this.listing.get(next)?.size ?? 0;
        }
        throw new Error(`Loading kept asking for more project files after ${maxPasses} fetches`);
    }

    public async refetch(paths: readonly string[]): Promise<void> {
        const keys = [...new Set(paths.map(normalizePath))];
        for (const key of keys) this.loaded.delete(key);
        await Promise.all(keys.map(key => this.startFetch(key)));
    }

    private fetchOnce(path: string): Promise<void> {
        return this.fetches.get(path) ?? this.startFetch(path);
    }

    private startFetch(path: string): Promise<void> {
        const fetch: Promise<void> = this.read(path).then(bytes => {
            if (this.fetches.get(path) === fetch) this.loaded.set(path, bytes);
        }).finally(() => {
            if (this.fetches.get(path) === fetch) this.fetches.delete(path);
        });
        this.fetches.set(path, fetch);
        return fetch;
    }

    private read(path: string): Promise<Uint8Array> {
        const requestId = this.nextRequestId++;
        return new Promise<Uint8Array>((resolve, reject) => {
            this.pending.set(requestId, {path, resolve, reject});
            this.channel.postMessage({type: PROJECT_FILES_MESSAGE_TYPE, kind: "read", requestId, path});
        });
    }

    private receive(message: ProjectFilesPageMessage): void {
        switch (message.kind) {
            case "listing":
                this.replaceListing(message.files);
                this.listed.resolve();
                break;
            case "listingFailed":
                this.listed.reject(new Error(`Could not list the project files: ${message.error}`));
                break;
            case "contents": {
                const pending = this.pending.get(message.requestId);
                if (pending === undefined) return;
                this.pending.delete(message.requestId);
                if (message.ok) pending.resolve(new Uint8Array(message.bytes));
                else pending.reject(new Error(`Could not read project file ${pending.path}: ${message.error}`));
                break;
            }
        }
    }

    private replaceListing(files: readonly ProjectListedFile[]): void {
        const next = new Map<string, ProjectListedFile>();
        for (const file of files) {
            const path = normalizePath(file.path);
            next.set(path, {path, size: file.size, mtimeMs: file.mtimeMs});
        }
        for (const path of [...this.loaded.keys()]) {
            const before = this.listing.get(path);
            const after = next.get(path);
            if (after === undefined || before === undefined || !sameListedFile(before, after)) this.loaded.delete(path);
        }
        this.listing = next;
        this.sortedListing = [...next.values()].map(({path, size}) => ({path, size})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    }
}
