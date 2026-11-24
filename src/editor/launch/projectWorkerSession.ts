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
import type {InputEventSink} from "../../engine/input/inputEvent";
import type {EditorSessionDisplay, EditorViewport, SessionDisplayEvents} from "./editorViewport";
import {connectSceneView} from "./sceneViewConnection";
import type {SceneViewConnection} from "./sceneViewConnection";
import {terminalInputMessage} from "./terminalInputChannel";

export const EDITOR_REQUEST_TIMEOUT_MS = 60_000;
export const BUFFERED_EDITOR_EVENT_LIMIT = 1000;

const MODULE_WORKER: WorkerOptions = {type: "module"};
const SCENE_VIEW_FAILURES_KEEP_THE_SESSION: SessionDisplayEvents = {failed: () => undefined};

export interface SessionVisibility {
    readonly visible: boolean;
}

export interface EditorViewports {
    readonly game: EditorViewport;
    readonly scene: EditorViewport;
}

export interface ProjectWorkerSessionOptions {
    readonly workerUrl: string;
    readonly viewports: EditorViewports;
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
    public readonly input: InputEventSink;
    private disposed = false;

    private constructor(
        private readonly worker: Worker,
        private readonly display: EditorSessionDisplay,
        private readonly sceneDisplay: EditorSessionDisplay,
        private readonly sceneView: SceneViewConnection,
        private readonly fileServing: ProjectFileServing,
        public readonly page: WorldWorkerPage,
        public readonly client: EditorClient,
        public readonly events: WorkerEditorEvents,
        viewport: EditorViewport,
    ) {
        this.input = viewport.sessionInput({events: page.input, terminalBytes: data => this.sendTerminalBytes(data)});
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
                sceneView.close();
                worker.terminate();
                if (!options.visibility.visible) {
                    display.dispose();
                    sceneDisplay.dispose();
                }
                reject(new Error(text));
            };
            const sceneDisplay = options.viewports.scene.sessionDisplay(options.visibility.visible, SCENE_VIEW_FAILURES_KEEP_THE_SESSION);
            const sceneView = connectSceneView(sceneDisplay, worker, options.name);
            const display = options.viewports.game.sessionDisplay(options.visibility.visible, {
                failed: text => {
                    if (!settled) fail(text);
                    else session?.client.close();
                },
            });
            const page = connectWorldWorker(display, worker, {
                name: options.name,
                requestedRasterWorkers: requestedRasterWorkersFromQuery(options.search),
// The client is created on ready: requests sent before the worker attached the editor service are lost.
                onReady: () => {
                    if (settled) return;
                    settled = true;
                    session = new ProjectWorkerSession(worker, display, sceneDisplay, sceneView, fileServing, page, new EditorClient(worker, {timeoutMs: EDITOR_REQUEST_TIMEOUT_MS}), events, options.viewports.game);
                    resolve(session);
                },
                onQuit: () => {
                    session?.client.close();
                    options.onQuit();
                },
            });
        });
    }

    public show(): void {
        this.sceneDisplay.show();
        this.display.show();
    }

    public hide(): void {
        this.sceneDisplay.hide();
        this.display.hide();
    }

    public setSceneViewShown(shown: boolean): void {
        this.sceneView.setShown(shown);
    }

    public exit(): void {
        this.page.exit();
    }

    private sendTerminalBytes(data: string): void {
        if (!this.disposed) this.worker.postMessage(terminalInputMessage(data));
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.client.close();
        this.fileServing.dispose();
        this.sceneView.close();
        this.page.close();
        this.sceneDisplay.dispose();
        this.display.dispose();
    }
}
