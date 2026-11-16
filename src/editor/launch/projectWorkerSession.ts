import {connectWorldWorker} from "../../hosts/web/worldWorkerPage";
import type {WorldWorkerPage} from "../../hosts/web/worldWorkerPage";
import {requestedRasterWorkersFromQuery} from "../../hosts/web/worldWorkerProtocol";
import {isEditorEventMessage} from "../editorProtocol";
import type {EditorEvent} from "../editorProtocol";
import {EditorClient} from "../page/editorClient";
import type {EditorEventSource} from "../page/editorSession";
import type {ProjectFileSystem} from "../project/projectFileSystem";
import {serveProjectFiles} from "../project/projectFileServing";
import type {ProjectFileServing} from "../project/projectFileServing";
import type {EditorSessionDisplay, EditorViewport} from "./editorViewport";

export const EDITOR_REQUEST_TIMEOUT_MS = 60_000;
export const BUFFERED_EDITOR_EVENT_LIMIT = 1000;

const MODULE_WORKER: WorkerOptions = {type: "module"};

export interface SessionVisibility {
    readonly visible: boolean;
}

export interface ProjectWorkerSessionOptions {
    readonly workerUrl: string;
    readonly viewport: EditorViewport;
    readonly files: ProjectFileSystem;
    readonly name: string;
    readonly search: string;
    readonly visibility: SessionVisibility;
    readonly onQuit: () => void;
}

export class WorkerEditorEvents implements EditorEventSource {
    private readonly listeners = new Set<(event: EditorEvent) => void>();
    private buffered: EditorEvent[] | undefined = [];

    public constructor(worker: {addEventListener(type: "message", listener: (event: {readonly data: unknown}) => void): void}) {
        worker.addEventListener("message", event => {
            if (isEditorEventMessage(event.data)) this.deliver(event.data.event);
        });
    }

    public onEvent(listener: (event: EditorEvent) => void): () => void {
        const entry = (event: EditorEvent) => listener(event);
        this.listeners.add(entry);
        const buffered = this.buffered;
        this.buffered = undefined;
        if (buffered !== undefined) for (const event of buffered) entry(event);
        return () => {
            this.listeners.delete(entry);
        };
    }

    private deliver(event: EditorEvent): void {
        const buffered = this.buffered;
        if (buffered !== undefined) {
            buffered.push(event);
            if (buffered.length > BUFFERED_EDITOR_EVENT_LIMIT) buffered.shift();
            return;
        }
        for (const listener of [...this.listeners]) listener(event);
    }
}

export class ProjectWorkerSession {
    private disposed = false;

    private constructor(
        private readonly worker: Worker,
        private readonly display: EditorSessionDisplay,
        private readonly fileServing: ProjectFileServing,
        public readonly page: WorldWorkerPage,
        public readonly client: EditorClient,
        public readonly events: WorkerEditorEvents,
    ) {
    }

    public static start(options: ProjectWorkerSessionOptions): Promise<ProjectWorkerSession> {
        const worker = new Worker(options.workerUrl, MODULE_WORKER);
        const events = new WorkerEditorEvents(worker);
        const fileServing = serveProjectFiles(worker, options.files);
        return new Promise<ProjectWorkerSession>((resolve, reject) => {
            let settled = false;
            let session: ProjectWorkerSession | undefined;
            const fail = (text: string): void => {
                if (settled) return;
                settled = true;
                fileServing.dispose();
                worker.terminate();
                if (!options.visibility.visible) display.dispose();
                reject(new Error(text));
            };
            const display = options.viewport.sessionDisplay(options.visibility.visible, {
// The client is created on the first frame: requests sent before the worker attached the editor service are lost.
                firstFrame: () => {
                    if (settled) return;
                    settled = true;
                    session = new ProjectWorkerSession(worker, display, fileServing, page, new EditorClient(worker, {timeoutMs: EDITOR_REQUEST_TIMEOUT_MS}), events);
                    resolve(session);
                },
                failed: text => {
                    if (!settled) fail(text);
                    else session?.client.close();
                },
            });
            const page = connectWorldWorker(display, worker, {
                name: options.name,
                requestedRasterWorkers: requestedRasterWorkersFromQuery(options.search),
                onQuit: () => {
                    session?.client.close();
                    options.onQuit();
                },
            });
        });
    }

    public show(): void {
        this.display.show();
    }

    public hide(): void {
        this.display.hide();
    }

    public exit(): void {
        this.page.exit();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.client.close();
        this.fileServing.dispose();
        this.page.close();
        this.display.dispose();
    }
}
