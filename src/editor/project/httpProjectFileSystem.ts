import type {ProjectEntry, ProjectFileChange, ProjectFileSystem} from "./projectFileSystem";
import {requireProjectRelativePath} from "../../engine/project/projectPaths";
import {isFilesChangedEvent, PROJECT_EVENT_FILES_CHANGED, PROJECT_OPEN_EXTERNALLY_ROUTE, PROJECT_SHOW_IN_FOLDER_ROUTE, projectApiUrl, projectFileRoute} from "./projectServerApi";
import type {MakeDirectoryRequest, OpenExternallyRequest, ProjectApiError, RenameRequest, ShowInFolderRequest} from "./projectServerApi";

export interface HttpRequestInit {
    readonly method?: string;
    readonly body?: string | Uint8Array;
    readonly headers?: Readonly<Record<string, string>>;
    readonly cache?: RequestCache;
    readonly signal?: AbortSignal;
}

export interface HttpResponseLike {
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponseLike>;

export interface ProjectEventSource {
    on(eventName: string, listener: (data: unknown) => void): () => void;
}

export interface HttpProjectFileSystemOptions {
    readonly projectId: string;
    readonly rootLabel: string;
    readonly fetch: HttpFetch;
    readonly events: ProjectEventSource;
    readonly showInFolder?: boolean;
}

const PROJECT_ROOT_PATH = "";
const JSON_HEADERS: Readonly<Record<string, string>> = {"Content-Type": "application/json"};
const BINARY_HEADERS: Readonly<Record<string, string>> = {"Content-Type": "application/octet-stream"};
const NO_STORE: RequestCache = "no-store";

async function failureText(response: HttpResponseLike): Promise<string> {
    const text = await response.text().catch(() => "");
    try {
        const parsed = JSON.parse(text) as Partial<ProjectApiError>;
        if (typeof parsed.error === "string") return parsed.error;
    } catch {
        return text.length > 0 ? text : `HTTP ${response.status}`;
    }
    return `HTTP ${response.status}`;
}

export class HttpProjectFileSystem implements ProjectFileSystem {
    public readonly rootLabel: string;
    private readonly fetch: HttpFetch;
    private readonly events: ProjectEventSource;
    private readonly base: string;
    public readonly showInFolder?: (path: string) => Promise<void>;

    public constructor(options: HttpProjectFileSystemOptions) {
        this.rootLabel = options.rootLabel;
        this.fetch = options.fetch;
        this.events = options.events;
        this.base = projectApiUrl(`${encodeURIComponent(options.projectId)}/`);
        if (options.showInFolder === true) this.showInFolder = path => this.requestShowInFolder(path);
    }

    public async list(): Promise<readonly ProjectEntry[]> {
        const response = await this.request("list the project files", "files", {cache: NO_STORE});
        return JSON.parse(await response.text()) as ProjectEntry[];
    }

    public async read(path: string): Promise<Uint8Array> {
        const response = await this.request(`read ${path}`, this.fileRoute(path), {cache: NO_STORE});
        return new Uint8Array(await response.arrayBuffer());
    }

    public async readText(path: string): Promise<string> {
        return new TextDecoder("utf-8", {ignoreBOM: true}).decode(await this.read(path));
    }

    public async write(path: string, contents: Uint8Array | string): Promise<void> {
        await this.request(`write ${path}`, this.fileRoute(path), {method: "PUT", body: contents, headers: BINARY_HEADERS});
    }

    public async remove(path: string): Promise<void> {
        await this.request(`remove ${path}`, this.fileRoute(path), {method: "DELETE"});
    }

    public async rename(from: string, to: string): Promise<void> {
        const body: RenameRequest = {from: requireProjectRelativePath(from), to: requireProjectRelativePath(to)};
        await this.request(`rename ${from} to ${to}`, "rename", {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    }

    public async makeDirectory(path: string): Promise<void> {
        const body: MakeDirectoryRequest = {path: requireProjectRelativePath(path)};
        await this.request(`create the folder ${path}`, "mkdir", {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    }

    public async openExternally(path: string): Promise<void> {
        const body: OpenExternallyRequest = {path: requireProjectRelativePath(path)};
        await this.request(`open ${path} in an external editor`, PROJECT_OPEN_EXTERNALLY_ROUTE, {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    }

    private async requestShowInFolder(path: string): Promise<void> {
        const body: ShowInFolderRequest = {path: path === PROJECT_ROOT_PATH ? PROJECT_ROOT_PATH : requireProjectRelativePath(path)};
        await this.request(`show ${path === PROJECT_ROOT_PATH ? "the project folder" : path} in its folder`, PROJECT_SHOW_IN_FOLDER_ROUTE, {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    }

    public onChange(listener: (change: ProjectFileChange) => void): () => void {
        return this.events.on(PROJECT_EVENT_FILES_CHANGED, data => {
            if (isFilesChangedEvent(data)) listener({paths: data.paths});
        });
    }

    private fileRoute(path: string): string {
        return `file/${projectFileRoute(requireProjectRelativePath(path))}`;
    }

    private async request(what: string, route: string, init: HttpRequestInit): Promise<HttpResponseLike> {
        const response = await this.fetch(this.base + route, init);
        if (!response.ok) throw new Error(`Could not ${what}: ${await failureText(response)}`);
        return response;
    }
}
