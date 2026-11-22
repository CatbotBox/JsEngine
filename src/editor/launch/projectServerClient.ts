import {HttpProjectFileSystem} from "../project/httpProjectFileSystem";
import type {HttpFetch, HttpRequestInit, HttpResponseLike} from "../project/httpProjectFileSystem";
import {ServerEventStream} from "../project/serverEvents";
import type {StreamingFetch} from "../project/serverEvents";
import {editorSettingsOf} from "../project/editorSettings";
import type {EditorSettings, GameTarget} from "../project/editorSettings";
import {EDITOR_SETTINGS_UPDATE_METHOD, PROJECT_EDITOR_SETTINGS_ROUTE, projectApiUrl} from "../project/projectServerApi";
import type {
    BrowseResult,
    BuildProjectRequest,
    BuildProjectResult,
    CreateProjectRequest,
    OpenProjectRequest,
    OpenProjectResult,
    PickFolderResult,
    ProjectApiError,
    ProjectCapabilities,
} from "../project/projectServerApi";

const JSON_HEADERS: Readonly<Record<string, string>> = {"Content-Type": "application/json"};
const NO_STORE: RequestCache = "no-store";

function isCapabilities(value: unknown): value is ProjectCapabilities {
    if (typeof value !== "object" || value === null) return false;
    const capabilities = value as {build?: unknown, pickFolder?: unknown, browse?: unknown};
    return typeof capabilities.build === "boolean" && typeof capabilities.pickFolder === "boolean" && typeof capabilities.browse === "boolean";
}

async function errorOf(response: HttpResponseLike): Promise<string> {
    const text = await response.text().catch(() => "");
    try {
        const parsed = JSON.parse(text) as Partial<ProjectApiError>;
        return typeof parsed.error === "string" ? parsed.error : `HTTP ${response.status}`;
    } catch {
        return text.length > 0 ? text : `HTTP ${response.status}`;
    }
}

export function browserFetch(): HttpFetch & StreamingFetch {
    return (url: string, init?: HttpRequestInit) => fetch(url, init as RequestInit) as unknown as Promise<HttpResponseLike & Response>;
}

export class ProjectServerClient {
    private constructor(public readonly capabilities: ProjectCapabilities, private readonly fetch: HttpFetch & StreamingFetch) {
    }

    public static async connect(fetchFunction: HttpFetch & StreamingFetch = browserFetch()): Promise<ProjectServerClient | undefined> {
        try {
            const response = await fetchFunction(projectApiUrl("capabilities"), {cache: NO_STORE});
            if (!response.ok) return undefined;
            const capabilities = JSON.parse(await response.text()) as unknown;
            return isCapabilities(capabilities) ? new ProjectServerClient(capabilities, fetchFunction) : undefined;
        } catch {
            return undefined;
        }
    }

    public async pickFolder(): Promise<string | null> {
        return (await this.post<PickFolderResult>("pick-folder", {})).path;
    }

    public async browse(path: string | undefined): Promise<BrowseResult> {
        const query = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
        return await this.json<BrowseResult>(`browse${query}`, {cache: NO_STORE});
    }

    public async open(path: string): Promise<OpenProjectResult> {
        const body: OpenProjectRequest = {path};
        return await this.post<OpenProjectResult>("open", body);
    }

    public async create(path: string, name: string): Promise<OpenProjectResult> {
        const body: CreateProjectRequest = {path, name};
        return await this.post<OpenProjectResult>("create", body);
    }

    public async build(projectId: string, gameTarget?: GameTarget): Promise<BuildProjectResult> {
        const body: BuildProjectRequest = gameTarget === undefined ? {} : {gameTarget};
        return await this.post<BuildProjectResult>(`${encodeURIComponent(projectId)}/build`, body);
    }

    public async editorSettings(projectId: string): Promise<EditorSettings> {
        return editorSettingsOf(await this.json<unknown>(this.editorSettingsRoute(projectId), {cache: NO_STORE}));
    }

    public async updateEditorSettings(projectId: string, settings: EditorSettings): Promise<EditorSettings> {
        const init: HttpRequestInit = {method: EDITOR_SETTINGS_UPDATE_METHOD, body: JSON.stringify(settings), headers: JSON_HEADERS};
        return editorSettingsOf(await this.json<unknown>(this.editorSettingsRoute(projectId), init));
    }

    public events(projectId: string): ServerEventStream {
        return new ServerEventStream(projectApiUrl(`${encodeURIComponent(projectId)}/events`), {fetch: this.fetch});
    }

    public files(projectId: string, rootLabel: string, events: ServerEventStream): HttpProjectFileSystem {
        return new HttpProjectFileSystem({projectId, rootLabel, fetch: this.fetch, events});
    }

    private editorSettingsRoute(projectId: string): string {
        return `${encodeURIComponent(projectId)}/${PROJECT_EDITOR_SETTINGS_ROUTE}`;
    }

    private async post<T>(route: string, body: unknown): Promise<T> {
        return await this.json<T>(route, {method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS});
    }

    private async json<T>(route: string, init: HttpRequestInit): Promise<T> {
        const response = await this.fetch(projectApiUrl(route), init);
        if (!response.ok) throw new Error(await errorOf(response));
        return JSON.parse(await response.text()) as T;
    }
}
